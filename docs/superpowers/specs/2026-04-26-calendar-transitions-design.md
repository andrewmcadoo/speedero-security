# Calendar Transitions — Greg & Krista TT: Events on the Day Card

**Date:** 2026-04-26
**Status:** Design approved, ready for implementation plan

## Summary

Connect the dashboard to two principals' Google Calendars (Greg and Krista) and surface their transit events — calendar entries whose title is prefixed `TT:` — alongside the existing Teak Pickup / Drop Off sub-cards on a day's schedule. A day can carry multiple transitions per principal. Transitions are read-only mirrors of the calendars; v1 ships with no editing path back.

Visible to both EPO and management dashboards. May be revisited if the principals decide one role shouldn't see them.

## Source

- **Greg's Google Calendar** — calendar ID in env var `GOOGLE_CALENDAR_ID_GREG`.
- **Krista's Google Calendar** — calendar ID in env var `GOOGLE_CALENDAR_ID_KRISTA`.
- Each calendar is shared (read access) with the existing service account email used by the Sheets integration. No new auth identity.
- An event qualifies as a transition iff its `summary` matches `^\s*TT:\s*` (case-insensitive) **and** the post-strip title is non-empty.

## Visibility & Scope

- Transitions attach to **every** `DashboardEntry`, regardless of viewer role or assignment. No role gate.
- Transitions only appear on dates that already have a sheet row (the dashboard's existing definition of "a day"). Orphan transitions on dates without a sheet row are dropped with a single aggregated log line per render. The principals' workflow ensures this case is rare.

## Data Model

`src/types/schedule.ts`:

```ts
export type Principal = "greg" | "krista";

export interface Transition {
  person: Principal;
  title: string;     // event summary with leading "TT:" stripped + trimmed
  startsAt: string;  // ISO 8601 with offset, e.g. "2026-04-30T09:30:00-07:00"
  tz: string;        // event's IANA timezone, e.g. "America/Los_Angeles"
  eventId: string;   // Google Calendar event id (instance id for recurring) — React key
}

export interface DashboardEntry extends ScheduleEntry {
  // ...existing fields...
  transitions: Transition[]; // always present, possibly empty
}
```

Design notes:
- `transitions` is **never** undefined. Empty array means "no transitions today."
- Sort order (ascending by `startsAt`) is enforced at the data layer; UI does not sort.
- `Principal` is a union to allow adding a third principal later by extending the union and the calendar map. No structural changes required.
- No `endsAt`, `location`, or `description` — title and start time are sufficient per product decision. Easy to extend later.

## Calendar Fetch Layer

New module: `src/lib/google-calendar.ts`. Peer of `src/lib/google-sheets.ts`, same `GoogleAuth` pattern.

### Public API

```ts
export async function fetchTransitions(
  range: { startDate: string; endDate: string }, // ISO YYYY-MM-DD inclusive
): Promise<Transition[]>;
```

Returns a flat, time-sorted array across all configured principals.

### Internals

- **Auth:** `GoogleAuth` with the existing `GOOGLE_SHEETS_CLIENT_EMAIL` / `GOOGLE_SHEETS_PRIVATE_KEY`, plus scope `https://www.googleapis.com/auth/calendar.readonly`.
- **Principal map:**

  ```ts
  const PRINCIPAL_CALENDARS: { person: Principal; envVar: string }[] = [
    { person: "greg",   envVar: "GOOGLE_CALENDAR_ID_GREG" },
    { person: "krista", envVar: "GOOGLE_CALENDAR_ID_KRISTA" },
  ];
  ```

  Missing env var → that principal is skipped with a `console.warn`, fetch continues for the rest. Useful for preview environments where only one calendar may be shared.
- **Per-principal request:** `GET https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events` with:
  - `timeMin` = `range.startDate` 00:00 UTC, padded back by 1 day to absorb event-TZ vs. UTC date-boundary skew
  - `timeMax` = `range.endDate` 23:59 UTC, padded forward by 1 day
  - `singleEvents=true` (expands recurring events into instances)
  - `orderBy=startTime`
  - `q=TT:` (server-side full-text filter; UI still re-validates the prefix to avoid false positives like `"matt:"` containing the substring)
  - `maxResults=2500`
- **Concurrency:** the per-principal calls are `Promise.all`'d.
- **Per-event handling:**
  - Skip if `event.start.dateTime` is missing (all-day events use `event.start.date`; transitions are time-anchored).
  - Strip prefix `^\s*TT:\s*` (case-insensitive). Skip if post-strip title is empty.
  - Build `Transition`: `{ person, title, startsAt: event.start.dateTime, tz: event.start.timeZone ?? "UTC", eventId: event.id }`.
- **Sort:** ascending by `startsAt` across all principals before returning.

### Failure modes

- One principal's call fails (404, 403, network): log, return `[]` for that principal, continue with the other.
- All principals fail or auth fails: `fetchTransitions` returns `[]`, single error logged. Dashboard renders without transitions.
- The dashboard also wraps `fetchTransitions` in a try/catch (see "Dashboard Wiring") so an exception cannot crash the render path.

## Dashboard Wiring

`src/app/dashboard/page.tsx`:

- Add `fetchTransitionsData(range)` wrapper mirroring the existing `fetchScheduleData` (page.tsx:38–43): try/catch, returns `[]` on failure.
- Compute the date range from the schedule itself: `startDate = today`, `endDate = max(s.date for s in schedule)`. If schedule is empty, skip the call entirely; `transitions = []`.
- Add `fetchTransitionsData(range)` to the existing `Promise.all` at page.tsx:63 so it runs concurrently with the sheet + Supabase fetches.
- Bucket by date next to the existing `travelLegsByDate` map:

  ```ts
  const transitionsByDate = new Map<string, Transition[]>();
  for (const t of transitions) {
    const date = isoDateInTz(t.startsAt, t.tz); // YYYY-MM-DD in event's own TZ
    const list = transitionsByDate.get(date) ?? [];
    list.push(t);
    transitionsByDate.set(date, list);
  }
  ```

  Orphan transitions (no matching sheet date) are counted and logged once at the end of the loop.
- Attach `transitions: transitionsByDate.get(s.date) ?? []` to every `DashboardEntry` in **both** the management view (~page.tsx:110) and the EPO view (~page.tsx:170). No role gate.

### Date / Timezone Helper

`src/lib/schedule-utils.ts` gains:

```ts
export function isoDateInTz(iso: string, tz: string): string;       // "YYYY-MM-DD" in tz
export function formatTimeInTz(iso: string, tz: string): string;    // "9:30 AM" in tz
```

Both implemented with `Intl.DateTimeFormat` and `timeZone: tz`. No date library.

Bucketing uses the **event's own timezone** (decided in brainstorming): the date Greg/Krista intend on their phone, not UTC and not the viewer's local zone. Cross-midnight cases (e.g. an event at 23:30 PT while the principal is in Tokyo) bucket to the date as it reads in their current TZ.

## UI

### New component: `src/components/transitions-section.tsx`

```tsx
interface TransitionsSectionProps {
  transitions: Transition[];
}

export function TransitionsSection({ transitions }: TransitionsSectionProps) {
  if (transitions.length === 0) return null;

  const groups: { person: Principal; label: string }[] = [
    { person: "greg",   label: "Greg" },
    { person: "krista", label: "Krista" },
  ];

  return (
    <div className="space-y-3">
      {groups.map(({ person, label }) => {
        const items = transitions.filter((t) => t.person === person);
        if (items.length === 0) return null;
        return (
          <div key={person}>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">
              {label}
            </div>
            <ul className="space-y-1">
              {items.map((t) => (
                <li key={t.eventId} className="flex items-baseline gap-2">
                  <span className="shrink-0 font-mono text-[11px] text-gray-400">
                    {formatTimeInTz(t.startsAt, t.tz)}
                  </span>
                  <span className="text-xs text-gray-100">{t.title}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
```

- Group order is fixed by the `groups` constant (Greg, then Krista).
- A group with zero items renders nothing; the whole section returns `null` if both groups are empty.
- Sort within a group already ascending from the data layer.
- No per-person color in v1 — the labeled subsection carries identity.

### Edit: `src/components/schedule-detail-card.tsx`

Inside the expanded body, place `<TransitionsSection>` **above** the existing `pickupLeg` / `dropoffLeg` blocks:

```tsx
{expanded && (
  <div className="space-y-3 border-t border-gray-700/50 px-3 pb-3 pt-3">
    {/* ...existing activity grid, detail level, EPOs, FlightDetailsSection... */}

    <TransitionsSection transitions={entry.transitions} />

    {entry.pickupLeg && <TravelDetailsSection leg={entry.pickupLeg} />}
    {entry.dropoffLeg && <TravelDetailsSection leg={entry.dropoffLeg} />}
  </div>
)}
```

Header chips and `TeakToggle` are untouched. The collapsed card is identical to today.

## Edge Cases

| Case | Behavior |
|---|---|
| All-day event (`event.start.date`, no `dateTime`) | Skipped. |
| `TT:` event with empty/whitespace-only title after strip | Skipped + logged. |
| Recurring event | `singleEvents=true` expands instances; each instance is its own `Transition` keyed by its instance `eventId`. |
| Title prefix variants (`tt:`, `TT:`, `TT: `, `TT:foo`) | All accepted (case-insensitive, optional whitespace after colon). |
| Event edited mid-day | Live fetch on next render reflects the change. |
| Event spans midnight in its own TZ | Bucketed by **start** date in event TZ. `endsAt` is not part of the model. |
| One calendar fails | That principal returns `[]`; the other flows. |
| All calendars fail or auth fails | `fetchTransitions` returns `[]`. |
| Calendar env var missing | Principal skipped with warning. |
| Transition on a date with no sheet row | Dropped. Aggregated count logged once per render. |
| Schedule fetch returns empty | Skip the calendar fetch; `transitions = []`. |

## Environment

New env vars (production env lives at `/data/SecApp/shared/.env.production`):

```
GOOGLE_CALENDAR_ID_GREG=...@group.calendar.google.com
GOOGLE_CALENDAR_ID_KRISTA=...@group.calendar.google.com
```

The existing `GOOGLE_SHEETS_CLIENT_EMAIL` / `GOOGLE_SHEETS_PRIVATE_KEY` service account is reused. Required setup outside of code:

1. Add the Calendar API to the GCP project (if not already enabled).
2. Add `https://www.googleapis.com/auth/calendar.readonly` to the service account's allowed scopes.
3. Greg and Krista each share their calendar with the service account email at "See all event details" or higher.
4. Set the two new env vars in production.

## Performance

Two extra Calendar API calls per dashboard render, run in parallel with the existing sheet + Supabase fetches. Calendar API typical latency ~100–200 ms; since the calls overlap with the sheet fetch (the long pole today), wall-clock impact should be near zero. Verify after deploy; if it slows renders, introduce a short-lived in-memory cache without changing the data model.

## Testing

The codebase currently runs `bun test` against unit tests in `src/lib/` only — there is no React component test infrastructure (`@testing-library/react` etc.) installed. We follow that pattern: ship unit tests for the new pure modules; component-level coverage is verified by manual smoke-test in dev (golden path: a day with both principals' transitions; a day with only Greg's; a day with neither).

- `src/lib/google-calendar.test.ts` — unit tests against fixture JSON for the Calendar API response. Covers: prefix variants (`TT:`, `tt:`, `TT:  `, `TT:foo`); all-day event skip; empty-title-after-strip skip; two-principal merge + sort; one-calendar-fails partial flow; all-fail returns `[]`; missing env var skips that principal.
- `src/lib/schedule-utils.test.ts` — extend with cases for `isoDateInTz` and `formatTimeInTz`: same instant in two different `tz` values; cross-midnight in one TZ vs. another; DST transition day.

No live API in tests.

## Out of Scope (v1)

- Editing or creating transitions (read-only mirror of the calendars).
- Per-person color tagging or icons.
- Header chips on the collapsed card for transitions.
- Stub cards for days with transitions but no sheet row.
- Showing event end time, location, or description.
- Caching layer or Supabase-backed sync.
- Per-role visibility rules (visible to both for now; revisit if requested).
- A third principal — the `Principal` union allows it, but no plumbing yet.
- Transition presence affecting EPO assignment / coverage logic.

## File-Level Change List

- **New:** `src/lib/google-calendar.ts`
- **New:** `src/lib/google-calendar.test.ts`
- **New:** `src/components/transitions-section.tsx`
- **Edit:** `src/types/schedule.ts` — add `Principal`, `Transition`, extend `DashboardEntry`
- **Edit:** `src/lib/schedule-utils.ts` — add `isoDateInTz`, `formatTimeInTz`
- **Edit:** `src/lib/schedule-utils.test.ts` — extend with TZ helper tests
- **Edit:** `src/app/dashboard/page.tsx` — add `fetchTransitionsData` wrapper, range computation, parallel fetch, bucket map, attach to entries (both views)
- **Edit:** `src/components/schedule-detail-card.tsx` — render `<TransitionsSection>` above `pickupLeg` / `dropoffLeg`
- **Edit:** `.env.local.example` — document `GOOGLE_CALENDAR_ID_GREG` and `GOOGLE_CALENDAR_ID_KRISTA`
