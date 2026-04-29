# Dashboard Filter Performance — Design

**Date:** 2026-04-28
**Branch:** feat/historical-card-snapshots (or successor)

## Problem

The dashboard interface is "extremely slow" when switching between filter pills (`All Dates`, `Unassigned`, `This Week`, `Next Week`, `Past Assignments`) and when adjusting the date range. Users feel the latency on every interaction.

## Root Cause

In `src/components/dashboard-filters.tsx:49`, `handlePillClick` calls `router.push(...)`. In Next.js App Router, that re-runs `src/app/dashboard/page.tsx` as a server component. Each filter click pays for:

1. **Google Sheets API** — `fetchSchedule()`
2. **Google Calendar API** — `fetchTransitions(...)` (today−7 through farthest sheet date)
3. **Three Supabase queries in parallel** — `getDateSettings`, `getAllAssignmentsWithProfiles`, `getTravelLegs`
4. `getSnapshotsBetween` query
5. Possibly `runSnapshotForDates` lazy backfill (more I/O)
6. Profile + role-specific queries (`getAssignmentsForUser` or `getAllEpos`)
7. Full re-render of the dashboard tree

Sheets + Calendar are the long pole — typically 1–3s each. Every pill tap re-pays the full server cost even though the underlying data is mostly unchanged.

**Conceptual mistake:** `?filter=` is in URL state alongside `?start=` / `?end=`, but they are different things. Range params are *data* (they determine which rows to fetch). Filter pills are pure *view* predicates over rows already in memory. Today both go through `router.push`, which forces every interaction through the full server pipeline.

## Symptoms (confirmed)

- Pills are slow even when the date range hasn't changed.
- Range changes are also slow.
- Pills are notably worse than expected because they shouldn't need fresh data at all.

## Goals

- Filter pill clicks feel instant (no server round-trip).
- Range changes feel instant for typical interaction bursts (rapid back-to-back picks within ~10s).
- Sheets/Calendar edits remain visible in the dashboard within ~10–20s of the next interaction (near-real-time human perception).
- No regression to existing snapshot/backfill behavior.

## Non-Goals

- Replacing the server-rendered architecture wholesale (no SWR/React Query refactor).
- Caching per-user data (profile, user assignments) — small and request-specific.
- Caching snapshot reads — Postgres is not the bottleneck.

## Design

Two phases. Phase 1 ships independently and delivers the largest user-visible win. Phase 2 follows.

### Phase 1 — Pills become client-side filters

#### Component changes

**`src/components/dashboard-filters.tsx`**
- Remove `useRouter`, `usePathname`, and `router.push` from `handlePillClick`.
- Add `activeFilter: FilterOption` and `onFilterChange: (f: FilterOption) => void` props. Parent owns filter state.
- Keep `DateRangeControl` exactly as-is — date range still routes through `router.push`. Phase 2 addresses range slowness.
- URL persistence: on filter change, call `window.history.replaceState(null, '', newUrl)` so the URL reflects the current filter for share/bookmark/refresh, *without* triggering a Next.js navigation. Use `replaceState` (not `pushState`) — pills are a view toggle, not a history-worthy navigation.

**`src/app/dashboard/epo-dashboard.tsx` and `src/app/dashboard/management-dashboard.tsx`**
- Lift filter state to `useState<FilterOption>` initialized from `searchParams.filter` (read once on mount via `useSearchParams`).
- Apply the filter as a client-side predicate over the `entries` prop before rendering the card list.
- Empty state when filter matches zero entries: "No entries match this filter in the selected range."

**`src/lib/dashboard/filter.ts` (new)**
- Shared predicate map keyed by `FilterOption`. Both dashboards import.

#### Filter predicates

Pure functions over `DashboardEntry`. All required flags (`isPast`, `isThisWeek`, `isNextWeek`) already exist on the entry — no new server-side computation.

| Filter | Predicate |
|---|---|
| `all` | identity (returns all entries) |
| `unassigned` | `!entry.hasAssignment` (management dashboard only) |
| `this-week` | `entry.isThisWeek` |
| `next-week` | `entry.isNextWeek` |
| `past-assignments` | `entry.isPast && entry.hasUserAssignment` (EPO dashboard only) |

The exact predicate names map to existing entry fields; verify during implementation and adjust if a flag is named differently.

#### Server-side compatibility

- `page.tsx` continues to read `?filter` for backward-compat (e.g., a saved bookmark).
- The `filter` param no longer drives any server-side data filtering — it is consumed only by the initial-state read on the client.
- Range params (`start`, `end`, `date`) continue to drive server fetching unchanged.

#### Edge cases

- **Range excludes filter window** (e.g., range is today+30..today+60, user picks "this-week"): result is empty list — show empty state, do not refetch.
- **Initial load with `?filter=this-week`**: read on mount, set initial state. URL → state is one-way after mount.
- **Browser back/forward across pills**: with `replaceState`, no history entries are added. Acceptable for a view toggle.
- **Browser back/forward across range changes**: unchanged — range still routes through Next.js, so back/forward still works as today.

#### Files touched (Phase 1)

- `src/components/dashboard-filters.tsx` — refactor for parent-owned state (~30 LOC change).
- `src/app/dashboard/epo-dashboard.tsx` — add filter state + predicate apply (~20 LOC).
- `src/app/dashboard/management-dashboard.tsx` — same shape (~20 LOC).
- `src/lib/dashboard/filter.ts` — new, ~30 LOC.

### Phase 2 — TTL cache for live sources

#### Cache location

A module-level `CacheEntry | null` in `src/lib/snapshot/live-cache.ts` (new sibling to `freeze.ts`). Module state survives between requests on the same Node process. Serverless cold starts reset it — acceptable, just lower hit rate.

#### Cache shape

```ts
type CacheEntry = {
  today: string;           // YYYY-MM-DD; bust when day changes
  fetchedAt: number;       // Date.now() of last successful fetch
  refreshing: boolean;     // SWR in-flight guard
  value: AssembleSources;
  pendingFetch: Promise<AssembleSources> | null;  // dedupe concurrent misses
};
let cache: CacheEntry | null = null;
```

Single global entry — `today` is the only varying input and changes once per day.

#### Read flow

```
fetchAllLiveSourcesCached(supabase, today):
  if cache && cache.today === today:
    age = Date.now() - cache.fetchedAt
    if age < FRESH_MS:
      return cache.value                          // FRESH — instant
    if age < STALE_MS:
      kickOffBackgroundRefresh(supabase, today)   // SWR
      return cache.value                          // STALE — instant, refreshes for next call
    // else fall through to sync miss

  if cache?.pendingFetch:
    return cache.pendingFetch                    // dedupe concurrent misses

  return syncMiss(supabase, today)               // full latency
```

- `FRESH_MS = 10_000` (10 s)
- `STALE_MS = 60_000` (60 s)

After 60 s with no activity we refetch synchronously rather than serve data older than a minute.

#### Background refresh

```ts
function kickOffBackgroundRefresh(supabase, today) {
  if (cache?.refreshing) return;
  cache!.refreshing = true;
  fetchAllLiveSources(supabase, today)
    .then((v) => {
      cache = { today, fetchedAt: Date.now(), refreshing: false, value: v, pendingFetch: null };
    })
    .catch((err) => {
      console.error("[live-cache] background refresh failed:", err);
      if (cache) cache.refreshing = false;
    });
}
```

Background failures leave the stale entry in place; the next sync read after `STALE_MS` will retry. User-facing requests are never blocked by a background failure.

#### Concurrent miss dedupe

```ts
function syncMiss(supabase, today) {
  const p = fetchAllLiveSources(supabase, today);
  cache = { today, fetchedAt: 0, refreshing: false, value: undefined as any, pendingFetch: p };
  return p.then((v) => {
    cache = { today, fetchedAt: Date.now(), refreshing: false, value: v, pendingFetch: null };
    return v;
  }).catch((err) => {
    cache = null;  // don't pin a failure
    throw err;
  });
}
```

Multiple parallel first-requests share one fetch promise.

#### Cache invalidation on mutations

Anywhere the app *writes* to data the live sources read from, call `invalidateLiveSourcesCache()` after the write. Audit during implementation — likely candidates:

- Assignment create / update / delete
- Travel leg edits
- Date setting changes

Sheets / Calendar edits happen outside this app; the only freshness mechanism for those is the 10 s TTL — the AJ-acceptable compromise.

```ts
export function invalidateLiveSourcesCache(): void {
  cache = null;
}
```

#### What does NOT get cached

- `getProfile`, `getAssignmentsForUser`, `getAllEpos` — per-user, cheap, request-specific.
- `getSnapshotsBetween` — Postgres, not the bottleneck.
- `runSnapshotForDates` — write path.

#### Edge cases

- **Day rollover**: if `today` arg differs from `cache.today`, treat as miss. Old day's cache is implicitly discarded.
- **Process restart**: cache empty, first request pays full cost. Acceptable.
- **Lazy backfill (`runSnapshotForDates`)**: currently uses live sources from the same request. Cached value is fine — backfill operates on past dates, not the live window.
- **Background refresh in flight when day rolls over**: the `today` write in the `.then` callback overwrites with the *new* day's value, but the fetch was issued for the old day. Mitigation: capture `today` in closure and verify before writing back; if stale, discard result.

#### Files touched (Phase 2)

- `src/lib/snapshot/live-cache.ts` — new, the cache state machine (~80 LOC).
- `src/app/dashboard/page.tsx` — swap `fetchAllLiveSources` call to `fetchAllLiveSourcesCached` (1-line change).
- Mutation sites (TBD via grep) — call `invalidateLiveSourcesCache()` after writes.

#### Testing (Phase 2)

- Unit tests for the cache state machine: fresh hit, stale hit, sync miss, concurrent misses, day rollover, invalidation, background refresh failure.
- Integration: load the dashboard twice within 10 s, verify only one Sheets/Calendar fetch occurs.
- Manual: edit Google Sheet, verify dashboard reflects within ~10–20 s of next interaction.

## Rollout

- Phase 1 ships first, on its own commit/PR. Validate the user-visible win before adding cache complexity.
- Phase 2 ships separately. Independent of Phase 1 (could be skipped if Phase 1 alone resolves the pain).

## Risk & Mitigation

| Risk | Mitigation |
|---|---|
| Filter URL state out of sync with local state | Read URL only on mount; thereafter local state is source of truth; `replaceState` keeps URL aligned for share/refresh. |
| Cache returns data the user just edited | Invalidate cache on every relevant mutation. 10 s TTL bounds worst case for external Sheets edits. |
| Background refresh races day rollover | Closure-capture `today`, verify before writing cache back. |
| Concurrent misses fan out duplicate Sheets calls | `pendingFetch` promise dedupe. |
| Stale view after a long idle session | After 60 s, sync refetch — no data older than 60 s is shown. |

## Open Questions

None at design time. Mutation-site audit happens during implementation.
