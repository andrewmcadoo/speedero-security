# Historical Card Snapshots — Design

Date: 2026-04-28
Status: Approved (design); plan and implementation to follow

## Goal

Users can pick a date or date range and view cards for those dates. Past cards are frozen point-in-time snapshots and are read-only. Today and future cards continue to read live from Google Sheets and Google Calendar.

## Background

Today the dashboard re-fetches the schedule from Google Sheets and transitions from Google Calendar on every page load. Supplementary data (assignments, travel legs, date settings) lives in Supabase and is joined by date. If a sheet row disappears, the card vanishes — every Supabase row keyed to that date becomes orphaned because the dashboard iterates the live `schedule`. There is no way to view a card after the source row is removed, and no way to view a card for a date that aged out of the rolling window.

## Non-goals

- Re-snapshotting an already-frozen date (no admin escape hatch in v1)
- Recovering cards deleted from the source before either the cron or any page load could capture them
- Querying snapshots by sub-fields (search across activity, location, etc. — possible later via JSON ops or extracted columns)
- Changing how today and future cards work (live read-through stays)

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                        Dashboard load                               │
│                                                                     │
│  Range = [start, end]    today = getAnchorDates().today             │
│                                                                     │
│         ┌─── start..today-1 ───┐    ┌─── today..end ───┐            │
│         │   from snapshots     │    │   from live      │            │
│         │   (read-only)        │    │   sources        │            │
│         └──────────────────────┘    └──────────────────┘            │
│                                                                     │
│  Lazy backfill: any past date in the requested range that is        │
│  missing a snapshot AND has live source data is snapshotted         │
│  inline before render.                                              │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│  Nightly: systemd timer on Clipper → POST /api/snapshot/run         │
│                                                                     │
│  Endpoint: for every date in [today-7..today-1] without a snapshot, │
│            fetch live (sheet + calendar + supabase joins),          │
│            assemble a DashboardEntry, upsert into card_snapshots.   │
└────────────────────────────────────────────────────────────────────┘
```

The seam is **strictly date-based**: dates strictly less than `today` (in `APP_TIMEZONE`) come from `card_snapshots`; dates `today` or later come from live sources. There is no overlap and no merge step.

## Data model

One new table: `card_snapshots`.

```sql
create table card_snapshots (
  date date primary key,
  payload jsonb not null,                  -- frozen DashboardEntry
  frozen_at timestamptz not null default now(),
  frozen_by text not null check (frozen_by in ('cron', 'lazy', 'manual'))
);

create index idx_card_snapshots_date on card_snapshots(date);

alter table card_snapshots enable row level security;

create policy "Authenticated can read snapshots"
  on card_snapshots for select
  using (auth.uid() is not null);

create policy "Management can insert snapshots"
  on card_snapshots for insert with check (is_management());

create policy "Management can update snapshots"
  on card_snapshots for update using (is_management());
```

`payload` mirrors the current `DashboardEntry` shape. A small helper, `freezeDashboardEntry(entry): jsonb`, serializes the entry to keep the contract explicit and to give us a single place to add a payload version field later if the shape needs to evolve.

The `frozen_by` column is for operational visibility only ("did this row get captured by the scheduled cron, by a user-triggered lazy backfill, or by a future manual action?"). It does not affect read behavior.

## Freeze pipeline

### Endpoint

`POST /api/snapshot/run`

- **Auth:** shared bearer in `SNAPSHOT_CRON_TOKEN` env var. The endpoint accepts requests only when the bearer matches. Defense in depth — the systemd unit binds to loopback (`127.0.0.1`), which is what the existing `speedero-security.service` already enforces via `Environment=HOSTNAME=127.0.0.1`.
- **Logic:**
  ```ts
  const { today } = getAnchorDates();
  const candidates = datesBetween(addDays(today, -7), addDays(today, -1));
  const existing = new Set(await getSnapshotDates(candidates));
  const missing = candidates.filter(d => !existing.has(d));

  // Fetch live sources once
  const [schedule, transitions, assignments, travelLegs, settings] = await Promise.all([...]);

  const result = { snapshotted: [] as string[], unrecoverable: [] as string[] };
  for (const date of missing) {
    const entry = assembleDashboardEntry(date, { schedule, transitions, assignments, travelLegs, settings });
    if (!entry) {
      result.unrecoverable.push(date);
      continue;
    }
    await upsertSnapshot(date, entry, "cron");
    result.snapshotted.push(date);
  }
  return Response.json(result);
  ```

The seven-day look-back gives the cron multiple opportunities to capture a date even if a single run fails or the sheet row was edited shortly after the date passed. Once a date has a snapshot, the cron skips it forever (no overwrites).

### Systemd units

Two new files alongside `scripts/deploy/speedero-security.service`:

`scripts/deploy/speedero-snapshot.service`
```ini
[Unit]
Description=Speedero Security — nightly snapshot
After=network-online.target speedero-security.service
Requires=speedero-security.service

[Service]
Type=oneshot
User=andrew
EnvironmentFile=/data/SecApp/shared/.env.production
ExecStart=/usr/bin/curl -fsS \
  -H "Authorization: Bearer ${SNAPSHOT_CRON_TOKEN}" \
  -X POST http://127.0.0.1:3000/SecApp/api/snapshot/run
StandardOutput=journal
StandardError=journal
```

`scripts/deploy/speedero-snapshot.timer`
```ini
[Unit]
Description=Run nightly snapshot at 00:30 PT

[Timer]
OnCalendar=*-*-* 00:30:00 America/Los_Angeles
Persistent=true

[Install]
WantedBy=timers.target
```

`Persistent=true` re-runs the timer on next boot if it was missed during downtime. `OnCalendar` with an explicit zone aligns the fire time with `APP_TIMEZONE` and handles DST without UTC arithmetic.

A new section in `scripts/deploy/SETUP.md` documents the one-time install on Clipper:

```bash
sudo cp scripts/deploy/speedero-snapshot.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now speedero-snapshot.timer
```

A new env var, `SNAPSHOT_CRON_TOKEN`, must be added to `/data/SecApp/shared/.env.production` before enabling the timer. The same env file is loaded by both `speedero-security.service` and `speedero-snapshot.service`.

### Lazy backfill

When the dashboard loads with a range that includes past dates, after the snapshot read it computes which past dates in the range have no snapshot. For each, it calls the same `assembleDashboardEntry` helper against the live data already fetched for the today/future portion. If a live row exists for that past date, it is snapshotted with `frozen_by = 'lazy'` before render.

Lazy backfill never re-snapshots a date that already has a snapshot — same write rule as the cron.

## Read path

`dashboard/page.tsx` (and any helpers it factors out) becomes:

```ts
const { today, tomorrow } = getAnchorDates();
const { start, end } = parseRangeFromSearchParams(searchParams);

const pastEnd = minDate(end, addDays(today, -1));   // last past date in range
const liveStart = maxDate(start, today);             // first live date in range

const livePromise = end >= today
  ? fetchLiveData({ from: liveStart, to: end })
  : Promise.resolve({ entries: [] });

const snapshotPromise = start < today
  ? getSnapshotsBetween(start, pastEnd)
  : Promise.resolve([]);

const [live, snapshots] = await Promise.all([livePromise, snapshotPromise]);

// Lazy backfill any past gaps in the requested range (capped to pastEnd)
const backfilled = start < today
  ? await backfillMissingSnapshots({
      start,
      end: pastEnd,
      have: snapshots,
      liveSources: live.sources,
    })
  : [];

const allSnapshots = [...snapshots, ...backfilled];
const past: DashboardEntry[] = allSnapshots.map(s => ({
  ...s.payload,
  isPast: true,
  isFromSnapshot: true,
}));
const future: DashboardEntry[] = live.entries.map(e => ({ ...e, isPast: false }));

const haveDates = new Set([...past.map(p => p.date), ...future.map(f => f.date)]);
const missing: DashboardEntry[] = datesBetween(start, end)
  .filter(d => d < today && !haveDates.has(d))
  .map(d => emptyMissingEntry(d));

const entries = [...past, ...missing, ...future].sort((a, b) =>
  a.date.localeCompare(b.date)
);
```

The dashboard components already render `isPast` correctly for the read-only treatment used by the existing rolling-window past dates. We add an `isMissing` branch for past dates with neither snapshot nor live row — see "Edge cases" below.

## UI: date picker in the filter row

`DashboardFilters` gains a new control between the existing pill filters and the search input:

```tsx
<DateRangeControl
  start={range.start}
  end={range.end}
  onChange={setRange}
  presets={[
    { label: "Today",        range: [today, today] },
    { label: "This week",    range: [today, addDays(today, 6)] },
    { label: "Last week",    range: [addDays(today, -7), addDays(today, -1)] },
    { label: "Past 30 days", range: [addDays(today, -30), addDays(today, -1)] },
  ]}
/>
```

- **Trigger:** a compact `[📅] Mar 12 → Mar 18` button. The calendar icon (left half of the trigger) toggles the popover; clicking the date text also opens it. Clicking outside closes it.
- **Popover:** single-month grid with prev/next-month chevrons. Click pattern matches Kayak/Airbnb: first click sets the start, second click sets the end, third click restarts. Selected range highlighted (start/end with rounded corners, in-between days filled). Quick presets across the bottom.
- **Single date** is represented as a 1-day range (`start === end`). The same control handles both shapes.
- **State location:** range lives in URL search params (`?start=2026-03-12&end=2026-03-18`) so it survives refresh, is shareable, and the server component reads it directly without client hydration tricks.
- **Default range on first load:** management gets `today..today+30`; EPOs get `today-7..today+30`. Past dates outside the default are reachable by widening the start date or by picking a preset.

  *Behavior change for EPOs:* the existing EPO dashboard renders every row currently in the sheet (the unused `filterRollingWindow` helper notwithstanding). With the picker in place, EPOs default to the last 7 days of past instead of the full sheet history. This is a deliberate trade — the picker is the new way to reach deep history, and an unbounded default makes the new past-snapshot read paths render whatever happens to still be in the sheet on top of older snapshots, which muddles the seam. EPOs who used the dashboard as a long-term archive can pick "Past 30 days" or drag the start back further.
- **No hard cap on range size** in v1. The picker UI suggests a soft default (presets max out at "Past 30 days") but a user can drag wider.

The existing pill filters (All Dates, Unassigned, This Week, Next Week) continue to operate as a layer on top of the date-range result set.

## Read-only enforcement

### UI

Audit every mutation affordance — assign EPO, unassign EPO, edit travel legs, change detail level, set Teak toggle, etc. Each must check `isPast` and hide (or disable with a tooltip) when true. Most components already do this; the audit closes any gaps.

### Server actions

The current codebase has no application-server boundary for mutations: `epo-assignment.tsx`, `teak-toggle.tsx`, and `detail-dropdown.tsx` all talk to Supabase directly from the client via `createClient().from("…").insert()`. To attach a guard server-side, we introduce Next.js server actions and refactor the three components to call them instead of touching Supabase directly.

**New file:** `src/app/dashboard/actions.ts` (`'use server'`). Six exported actions, one per mutation:

| Action | Replaces | Table |
|---|---|---|
| `assignEpo(date, epoId)` | `epo-assignment.tsx:47` insert | `assignments` |
| `unassignEpo(date, epoId)` | `epo-assignment.tsx:67` delete | `assignments` |
| `createTravelLeg(date, action)` | `teak-toggle.tsx:104` insert | `travel_legs` |
| `updateTravelLeg(date, action, fields)` | `teak-toggle.tsx:158` update | `travel_legs` |
| `deleteTravelLeg(date, action)` | `teak-toggle.tsx:127` delete | `travel_legs` |
| `setDetailLevel(date, level)` | `detail-dropdown.tsx:32` upsert | `date_settings` |

Each action:
1. Resolves the current user via `createClient()` from `@/lib/supabase/server` (server-side cookie-bound session).
2. Calls `assertNotPast(date)` from a new `src/lib/access-control.ts`. If `date < getAnchorDates().today`, throws so the action returns an error.
3. Performs the Supabase write using the resolved session (RLS still applies for management-only checks).
4. Returns `{ ok: true }` or `{ ok: false, error: string }` for the caller to act on.

The three client components are refactored to:
- Drop `import { createClient } from "@/lib/supabase/client"` and the inline `supabase.from(...)` calls.
- Import the matching action from `@/app/dashboard/actions`.
- Keep their existing optimistic-update pattern: set local state first, await the action, revert on error, otherwise `router.refresh()`. Server actions are awaitable promises just like the current Supabase calls.
- `profileId` no longer needs to be passed in as a prop — the server action resolves the user via session. Audit prop drilling and remove where it becomes unused.

Per-action unit test verifies the past-date rejection (the test imports the action and calls it with a past date; assert it returns `{ ok: false }` or throws). The test does not need a live Supabase connection because the guard runs before any DB call — mock the supabase client to confirm no `.from()` invocation when the date is past.

### Not in scope

Tightening Supabase RLS to also reject past-date writes is **explicitly out of scope** for v1. The threat model is "stale browser state lets a user accidentally edit an old card", not "a determined attacker with service-role keys". UI + API guard catches the realistic case at acceptable cost.

## Operational concerns

- **Observability.** The snapshot endpoint logs `snapshotted=[…] skipped=[…] unrecoverable=[…]` to journald. Visible via `journalctl -u speedero-snapshot`. A manual smoke test from Clipper:
  ```bash
  curl -fsS -H "Authorization: Bearer $SNAPSHOT_CRON_TOKEN" \
    -X POST http://127.0.0.1:3000/SecApp/api/snapshot/run
  ```
- **Missed-day handling.** Lazy backfill catches recent misses on the next page load. Truly-lost dates (cron failed AND every page load missed them before sheet deletion) render as the `isMissing` placeholder.
- **DST.** `OnCalendar=*-*-* 00:30:00 America/Los_Angeles` keeps the timer aligned with `APP_TIMEZONE` across DST transitions. No UTC arithmetic.
- **Cron failures.** `Persistent=true` re-runs the timer on next boot if it missed during downtime. Lazy backfill is the additional safety net for everything else.

## Edge cases

- **Today is special.** A range of `today..today` does not consult `card_snapshots`; today is always live. At midnight, today rolls into the cron's catch window for the next nightly run.
- **Range spans midnight rollover during a long session.** Ignored. The page renders against the moment of load. A refresh after midnight reflects the new "today".
- **Schedule-row updates between freeze attempts in the look-back window.** The cron fills only *missing* snapshots; it never overwrites. A date is snapshotted on the first successful pass and stays as captured.
- **A re-added sheet row for a previously-deleted past date.** Ignored. The snapshot is whatever was captured. Re-snapshotting is explicitly out of scope for v1.
- **Past date with neither snapshot nor live row** (`isMissing`). Renders as a small "?" placeholder card with the date label and a tooltip "no snapshot captured". This indicator only appears for dates that the user explicitly asked for via the range picker — it is never injected into the default range.
- **Cron token rotation.** Rotating `SNAPSHOT_CRON_TOKEN` requires updating `/data/SecApp/shared/.env.production` and restarting both `speedero-security.service` and `speedero-snapshot.service` so both pick up the new value.

## File-level change summary

| Area | Files |
|---|---|
| New migration | `supabase/migrations/011_card_snapshots.sql` |
| New types | `src/types/schedule.ts` (`CardSnapshot`, payload contract) |
| Snapshot read | `src/lib/supabase/queries.ts` (`getSnapshotsBetween`, `getSnapshotDates`, `upsertSnapshot`) |
| Freeze pipeline | `src/app/api/snapshot/run/route.ts`, `src/lib/snapshot/assemble.ts`, `src/lib/snapshot/freeze.ts` |
| Lazy backfill | helper colocated with the freeze pipeline, called from `dashboard/page.tsx` |
| Dashboard read split | `src/app/dashboard/page.tsx` and a new `src/lib/dashboard/range.ts` for `parseRangeFromSearchParams` and the past/live split |
| Date picker UI | `src/components/dashboard-filters.tsx`, new `src/components/date-range-control.tsx` |
| Read-only guards | new `src/lib/access-control.ts` (`assertNotPast`); new `src/app/dashboard/actions.ts` with six server actions; refactor `src/components/epo-assignment.tsx`, `src/components/teak-toggle.tsx`, `src/components/detail-dropdown.tsx` to call the actions instead of `supabase.from()` directly |
| Missing placeholder | small new branch in the dashboard card rendering for `isMissing` |
| Systemd units | `scripts/deploy/speedero-snapshot.service`, `scripts/deploy/speedero-snapshot.timer` |
| Setup docs | `scripts/deploy/SETUP.md` (install + token rotation section) |
| Env | `SNAPSHOT_CRON_TOKEN` added to `/data/SecApp/shared/.env.production` (one-time, before enabling the timer) |

## Open implementation questions

These do not block design approval but should be settled in the implementation plan:

1. Does `assembleDashboardEntry` live in `src/lib/snapshot/` or factor out of the existing `dashboard/page.tsx` orchestration into a shared helper used by both the live and the freeze paths? (Recommend the latter — single source of truth for "what a card is".)
2. Is the past/live merge done in the server component (current sketch) or pushed into a query helper that returns the merged list? (Recommend keeping the merge in the server component while it's small; factor out when it grows.)
3. Should the `?start=&end=` URL params be canonicalized and validated by `parseRangeFromSearchParams` (clamp to a sane min/max, fall back to defaults on garbage)? (Yes — defensive parsing avoids server errors on hand-edited URLs.)
