# Dashboard Filter Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make filter pill clicks instant (no server round-trip) and smooth out rapid range-picker interactions with a 10s/60s SWR cache for `fetchAllLiveSources`.

**Architecture:** Phase 1 — pills become local React state in the dashboards, with URL sync via `window.history.replaceState`; the `?filter=` param no longer triggers `router.push`, so server components don't re-run on a pill click. Phase 2 — wrap `fetchAllLiveSources` with a module-level cache (`live-cache.ts`) that does fresh-hit → stale-while-revalidate → sync-miss based on `Date.now()`; mutation server actions call `invalidateLiveSourcesCache()` so writes are visible immediately.

**Tech Stack:** Next.js 16.2.1 (App Router), React 19.2.4, TypeScript 5, Supabase, `bun test` (`bun:test` API), Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-04-28-dashboard-filter-performance-design.md`

**Deviations from spec:**
- The spec proposed a shared `src/lib/dashboard/filter.ts` for predicates. After reading the actual code, EPO and Management dashboards have *disjoint* filter sets (EPO: all/this-week/next-week/past-assignments + an unconditional `assignedDates` pre-filter; Management: all/unassigned/this-week/next-week with no pre-filter), so a shared module would only collapse two trivial flag-reads. **YAGNI — predicates stay inline in each dashboard.** What we *do* extract is the pure URL-rewrite helper (`nextFilterSearch`), because that has real testable logic.

---

## File Structure

**Phase 1 — pills as client state:**
- CREATE `src/lib/dashboard/filter-url.ts` — pure URL-rewrite helpers (one responsibility: produce a new URLSearchParams string from a filter choice).
- CREATE `src/lib/dashboard/filter-url.test.ts` — unit tests for the helpers.
- MODIFY `src/components/dashboard-filters.tsx` — make `DashboardFilters` a controlled component (parent owns `activeFilter` and `onFilterChange`); remove `useRouter`/`router.push`.
- MODIFY `src/app/dashboard/epo-dashboard.tsx` — lift filter to `useState`, init from URL on mount, sync URL via `replaceState` on change.
- MODIFY `src/app/dashboard/management-dashboard.tsx` — same shape as EPO dashboard.

**Phase 2 — TTL cache:**
- CREATE `src/lib/snapshot/live-cache.ts` — cache state machine + `fetchAllLiveSourcesCached` + `invalidateLiveSourcesCache`. One responsibility: cached access to `fetchAllLiveSources`.
- CREATE `src/lib/snapshot/live-cache.test.ts` — unit tests for the cache (FRESH hit, STALE+SWR, sync miss, concurrent dedupe, day rollover, invalidate, background-refresh failure).
- MODIFY `src/app/dashboard/page.tsx` — swap one call site: `fetchAllLiveSources` → `fetchAllLiveSourcesCached`.
- MODIFY `src/app/dashboard/actions.ts` — add `invalidateLiveSourcesCache()` after each successful mutation (6 sites).

---

## Phase 1 — Pills become client-side filters

### Task 1: Pure URL-rewrite helper

**Files:**
- Create: `src/lib/dashboard/filter-url.ts`
- Test: `src/lib/dashboard/filter-url.test.ts`

The dashboards need to: (a) read the initial filter from a URLSearchParams string, and (b) produce the next URLSearchParams string when the user picks a different pill (clearing range params and clearing the `filter` param when it's the default `all`). Both are pure string transforms — perfect for unit tests.

- [ ] **Step 1: Write the failing test file**

Create `src/lib/dashboard/filter-url.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { readFilterFromSearch, nextFilterSearch } from "./filter-url";

describe("readFilterFromSearch", () => {
  test("returns 'all' when no filter param", () => {
    expect(readFilterFromSearch("")).toBe("all");
    expect(readFilterFromSearch("foo=bar")).toBe("all");
  });

  test("returns the filter value when present", () => {
    expect(readFilterFromSearch("filter=this-week")).toBe("this-week");
    expect(readFilterFromSearch("a=1&filter=unassigned&b=2")).toBe("unassigned");
  });

  test("returns 'all' when filter is unrecognized", () => {
    expect(readFilterFromSearch("filter=garbage")).toBe("all");
  });

  test("returns 'all' when both range and filter are set (range wins)", () => {
    // Mirrors the existing rule in dashboard-filters: a custom range zeroes out the filter pill.
    expect(readFilterFromSearch("start=2026-04-01&end=2026-04-30&filter=this-week")).toBe("all");
    expect(readFilterFromSearch("date=2026-04-15&filter=this-week")).toBe("all");
  });
});

describe("nextFilterSearch", () => {
  test("setting 'all' removes the filter param", () => {
    expect(nextFilterSearch("filter=this-week", "all")).toBe("");
    expect(nextFilterSearch("a=1&filter=this-week&b=2", "all")).toBe("a=1&b=2");
  });

  test("setting a non-all value writes the filter param", () => {
    expect(nextFilterSearch("", "this-week")).toBe("filter=this-week");
    expect(nextFilterSearch("a=1", "unassigned")).toBe("a=1&filter=unassigned");
  });

  test("changing the filter overwrites the existing filter param", () => {
    expect(nextFilterSearch("filter=this-week", "next-week")).toBe("filter=next-week");
  });

  test("clears range params (start, end, date) when a pill is chosen", () => {
    // Picking a pill should reset any custom range — matches existing behavior.
    expect(nextFilterSearch("start=2026-04-01&end=2026-04-30", "this-week")).toBe("filter=this-week");
    expect(nextFilterSearch("date=2026-04-15", "all")).toBe("");
    expect(nextFilterSearch("start=2026-04-01&filter=next-week", "this-week")).toBe("filter=this-week");
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun test src/lib/dashboard/filter-url.test.ts`
Expected: FAIL — module `./filter-url` does not exist.

- [ ] **Step 3: Implement `filter-url.ts`**

Create `src/lib/dashboard/filter-url.ts`:

```ts
import type { FilterOption } from "@/components/dashboard-filters";

const VALID_FILTERS: FilterOption[] = [
  "all",
  "unassigned",
  "my-assignments",
  "this-week",
  "next-week",
  "past-assignments",
];

/**
 * Read the active filter from a URLSearchParams query string.
 *
 * Mirrors the rule in DashboardFilters: when a custom range param is present
 * (start/end/date), the filter pill is treated as inactive — return "all" so
 * the dashboard renders the full range without an extra predicate.
 */
export function readFilterFromSearch(search: string): FilterOption {
  const params = new URLSearchParams(search);
  if (params.has("start") || params.has("end") || params.has("date")) {
    return "all";
  }
  const raw = params.get("filter");
  if (raw && (VALID_FILTERS as string[]).includes(raw)) {
    return raw as FilterOption;
  }
  return "all";
}

/**
 * Produce the next URLSearchParams string when the user picks a filter pill.
 * Clears any range params (pills are mutually exclusive with custom ranges)
 * and omits the filter param entirely when the choice is the default ("all").
 */
export function nextFilterSearch(search: string, filter: FilterOption): string {
  const params = new URLSearchParams(search);
  params.delete("start");
  params.delete("end");
  params.delete("date");
  if (filter === "all") {
    params.delete("filter");
  } else {
    params.set("filter", filter);
  }
  return params.toString();
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test src/lib/dashboard/filter-url.test.ts`
Expected: PASS — all six tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard/filter-url.ts src/lib/dashboard/filter-url.test.ts
git commit -m "feat(dashboard-filters): pure URL-rewrite helpers for filter pills"
```

---

### Task 2: Make `DashboardFilters` a controlled component

**Files:**
- Modify: `src/components/dashboard-filters.tsx`

The component currently reads/writes filter state via `useSearchParams` + `router.push`. We're inverting control: parent owns the state, component is a dumb pill renderer + range trigger.

This task changes the component's prop signature, which breaks both dashboard call-sites until Tasks 3 and 4 land. That's expected — keep these three tasks as a single logical unit and only commit at the end of Task 4 (or commit each task with a `wip:` marker; either is fine, but the build will be red between commits if you split).

- [ ] **Step 1: Replace the file contents**

Replace `src/components/dashboard-filters.tsx` with:

```tsx
"use client";

import { DateRangeControl } from "./date-range-control";
import type { DateRange } from "@/lib/dashboard/range";

export type FilterOption =
  | "all"
  | "unassigned"
  | "my-assignments"
  | "this-week"
  | "next-week"
  | "past-assignments";

interface FilterDef {
  value: FilterOption;
  label: string;
}

const DEFAULT_FILTERS: FilterDef[] = [
  { value: "all", label: "All Dates" },
  { value: "unassigned", label: "Unassigned" },
  { value: "this-week", label: "This Week" },
  { value: "next-week", label: "Next Week" },
];

export function DashboardFilters({
  searchQuery,
  onSearchChange,
  filters = DEFAULT_FILTERS,
  range,
  activeFilter,
  onFilterChange,
}: {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filters?: FilterDef[];
  range: DateRange;
  activeFilter: FilterOption | null;
  onFilterChange: (value: FilterOption) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex gap-1.5">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => onFilterChange(f.value)}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              activeFilter === f.value
                ? "bg-blue-900/60 text-blue-400"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <DateRangeControl range={range} />
        <input
          type="text"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="rounded-md bg-gray-800 px-3 py-1.5 text-xs text-gray-300 placeholder-gray-500 outline-none ring-1 ring-gray-700 focus:ring-gray-500"
        />
      </div>
    </div>
  );
}
```

What changed:
- Removed `useRouter`, `usePathname`, `useSearchParams` imports.
- Removed `handlePillClick` (no more `router.push`).
- Added `activeFilter` and `onFilterChange` to props; pill button calls `onFilterChange(f.value)` directly.
- Filter "active" computation is now a prop, not derived from URL inside this component.
- `DateRangeControl` is unchanged — range still routes through Next.js (Phase 2 problem).

- [ ] **Step 2: Note that the build is now broken**

`bun run build` (or `bun run lint`) will fail because `EpoDashboard` and `ManagementDashboard` don't yet pass the new required props. That's expected — Tasks 3 and 4 fix it. Do not commit yet.

---

### Task 3: Lift filter state into `EpoDashboard`

**Files:**
- Modify: `src/app/dashboard/epo-dashboard.tsx`

- [ ] **Step 1: Replace the file contents**

Replace `src/app/dashboard/epo-dashboard.tsx` with:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import type { DashboardEntry } from "@/types/schedule";
import { SignOutButton } from "@/components/sign-out-button";
import { ReportBugButton } from "@/components/report-bug-button";
import { DateHeader } from "@/components/date-header";
import { ScheduleDetailCard } from "@/components/schedule-detail-card";
import {
  DashboardFilters,
  type FilterOption,
} from "@/components/dashboard-filters";
import { nextFilterSearch, readFilterFromSearch } from "@/lib/dashboard/filter-url";

const EPO_FILTERS = [
  { value: "all" as const, label: "My Assignments" },
  { value: "this-week" as const, label: "This Week" },
  { value: "next-week" as const, label: "Next Week" },
  { value: "past-assignments" as const, label: "Past Assignments" },
];

export function EpoDashboard({
  entries,
  assignedDates,
  userName,
  todayISO,
  tomorrowISO,
  range,
}: {
  entries: DashboardEntry[];
  assignedDates: string[];
  userName: string;
  todayISO: string;
  tomorrowISO: string;
  range: { start: string; end: string };
}) {
  const firstName = (userName ?? "").trim().split(/\s+/)[0] || "";
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterOption>("all");

  // Read initial filter from URL once on mount. After mount, local state is
  // the source of truth; URL sync goes the other way via replaceState.
  useEffect(() => {
    setFilter(readFilterFromSearch(window.location.search));
  }, []);

  function handleFilterChange(next: FilterOption) {
    setFilter(next);
    const qs = nextFilterSearch(window.location.search, next);
    const url = `${window.location.pathname}${qs ? "?" + qs : ""}`;
    // Shallow URL update — Next.js 16 routes window.history.replaceState
    // through its internal store so useSearchParams stays in sync, but
    // server components do NOT re-run.
    window.history.replaceState(null, "", url);
  }

  const filtered = useMemo(() => {
    let result = entries.filter((e) => assignedDates.includes(e.date));

    switch (filter) {
      case "all":
        result = result.filter((e) => !e.isPast);
        break;
      case "this-week":
        result = result.filter((e) => e.isThisWeek);
        break;
      case "next-week":
        result = result.filter((e) => e.isNextWeek);
        break;
      case "past-assignments":
        result = result.filter((e) => e.isPast);
        break;
    }

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.activity.toLowerCase().includes(q) ||
          e.location.toLowerCase().includes(q)
      );
    }

    return result;
  }, [entries, filter, search, assignedDates]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Speedero Security</h1>
          <p className="text-sm text-gray-400">
            {firstName ? `${firstName}'s Assignment Schedule` : "Assignment Schedule"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ReportBugButton />
          <SignOutButton />
        </div>
      </header>

      <div className="mb-4">
        <DashboardFilters
          searchQuery={search}
          onSearchChange={setSearch}
          filters={EPO_FILTERS}
          range={range}
          activeFilter={filter}
          onFilterChange={handleFilterChange}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="mt-20 text-center">
          <p className="text-lg text-gray-500">
            {entries.length === 0
              ? "No assigned dates"
              : "No matching entries"}
          </p>
          <p className="mt-1 text-sm text-gray-600">
            {entries.length === 0
              ? "Check back later or contact your supervisor."
              : "Try adjusting your filters."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((entry) => (
            <div key={entry.date} className="space-y-2">
              <DateHeader
                dateStr={entry.date}
                status={entry.confirmationStatus}
                todayISO={todayISO}
                tomorrowISO={tomorrowISO}
              />
              <ScheduleDetailCard entry={entry} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

What changed:
- Removed `useSearchParams`; replaced with `useState` + `useEffect` initializer.
- Added `handleFilterChange` that updates state and calls `window.history.replaceState`.
- Pass `activeFilter` and `onFilterChange` to `DashboardFilters`.
- `useMemo` predicate body is unchanged.

---

### Task 4: Lift filter state into `ManagementDashboard`

**Files:**
- Modify: `src/app/dashboard/management-dashboard.tsx`

- [ ] **Step 1: Replace the file contents**

Replace `src/app/dashboard/management-dashboard.tsx` with:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import type { DashboardEntry } from "@/types/schedule";
import { SignOutButton } from "@/components/sign-out-button";
import { ReportBugButton } from "@/components/report-bug-button";
import { DateHeader } from "@/components/date-header";
import { ManagementCard } from "@/components/management-card";
import {
  DashboardFilters,
  type FilterOption,
} from "@/components/dashboard-filters";
import { nextFilterSearch, readFilterFromSearch } from "@/lib/dashboard/filter-url";
import Link from "next/link";

export function ManagementDashboard({
  entries,
  epos,
  profileId,
  todayISO,
  tomorrowISO,
  range,
}: {
  entries: DashboardEntry[];
  epos: { id: string; fullName: string; email: string }[];
  profileId: string;
  todayISO: string;
  tomorrowISO: string;
  range: { start: string; end: string };
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterOption>("all");

  useEffect(() => {
    setFilter(readFilterFromSearch(window.location.search));
  }, []);

  function handleFilterChange(next: FilterOption) {
    setFilter(next);
    const qs = nextFilterSearch(window.location.search, next);
    const url = `${window.location.pathname}${qs ? "?" + qs : ""}`;
    window.history.replaceState(null, "", url);
  }

  const filtered = useMemo(() => {
    let result = entries;

    switch (filter) {
      case "unassigned":
        result = result.filter((e) => e.assignedEpos.length === 0);
        break;
      case "this-week":
        result = result.filter((e) => e.isThisWeek);
        break;
      case "next-week":
        result = result.filter((e) => e.isNextWeek);
        break;
    }

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.activity.toLowerCase().includes(q) ||
          e.location.toLowerCase().includes(q)
      );
    }

    return result;
  }, [entries, filter, search]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Speedero Security</h1>
          <p className="text-sm text-gray-400">Management Dashboard</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/users"
            className="rounded-md px-3 py-1.5 text-xs text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
          >
            Manage Users
          </Link>
          <ReportBugButton />
          <SignOutButton />
        </div>
      </header>

      <div className="mb-4">
        <DashboardFilters
          searchQuery={search}
          onSearchChange={setSearch}
          range={range}
          activeFilter={filter}
          onFilterChange={handleFilterChange}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="mt-20 text-center">
          <p className="text-lg text-gray-500">
            {entries.length === 0
              ? "No schedule data"
              : "No matching entries"}
          </p>
          <p className="mt-1 text-sm text-gray-600">
            {entries.length === 0
              ? "Check your Google Sheets connection."
              : "Try adjusting your filters."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((entry) => (
            <div key={entry.date} className="space-y-2">
              <DateHeader
                dateStr={entry.date}
                status={entry.confirmationStatus}
                todayISO={todayISO}
                tomorrowISO={tomorrowISO}
              />
              <ManagementCard
                entry={entry}
                allEpos={epos}
                profileId={profileId}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `bun run lint`
Expected: clean (or pre-existing warnings only — no new errors).

Run: `bunx tsc --noEmit`
Expected: clean — no type errors.

If either fails, fix before proceeding. The most likely error is an unused import (e.g., a leftover `useSearchParams`).

- [ ] **Step 3: Manual smoke test in dev**

Run: `bun run dev`
Open the dashboard in a browser. Verify:
1. Click each pill — the URL updates (`?filter=this-week`), the page does NOT show a Next.js loading flash, and entries narrow instantly.
2. Open DevTools → Network → filter to `Fetch/XHR`. Click pills. There should be **no** RSC `?_rsc=...` request fired. (Range picker clicks SHOULD still fire one — Phase 2.)
3. Hard-refresh with `?filter=next-week` in the URL. The "Next Week" pill should be active on initial render.
4. Range picker still works and the filter pills reset to "all" when a custom range is set.
5. Sign out as EPO, sign in as management — same checks. "Unassigned" filter shows only entries with no assigned EPOs.

If any of these fail, debug before committing. **The shallow-routing assumption is the highest-risk part of this phase** — if Next.js 16 *does* re-run server components on `replaceState`, the perf win is lost and we need a different URL-sync strategy. The Network-tab check in step 2 is the diagnostic.

- [ ] **Step 4: Commit Phase 1**

```bash
git add src/components/dashboard-filters.tsx src/app/dashboard/epo-dashboard.tsx src/app/dashboard/management-dashboard.tsx
git commit -m "feat(dashboard-filters): client-side pill filtering with shallow URL sync

Pills no longer trigger router.push, so server components don't re-run
on a filter change. URL still reflects the active pill via
window.history.replaceState for share/bookmark/refresh."
```

---

## Phase 2 — TTL cache for `fetchAllLiveSources`

### Task 5: Create the cache module with FRESH-hit behavior

**Files:**
- Create: `src/lib/snapshot/live-cache.ts`
- Test: `src/lib/snapshot/live-cache.test.ts`

We build the cache state machine via TDD. The module exports a public API (`fetchAllLiveSourcesCached`, `invalidateLiveSourcesCache`) plus test seams (`_resetForTest`, `_peekForTest`, `_fetchAllLiveSourcesCachedForTest`) that take an injected fetcher and clock — same pattern as `dashboard/actions.ts`'s `_assignEpoForTest`.

- [ ] **Step 1: Write the failing test for FRESH hits**

Create `src/lib/snapshot/live-cache.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssembleSources } from "./assemble";
import {
  FRESH_MS,
  STALE_MS,
  _fetchAllLiveSourcesCachedForTest,
  _peekForTest,
  _resetForTest,
  invalidateLiveSourcesCache,
} from "./live-cache";

afterEach(() => {
  _resetForTest();
});

const STUB_SUPABASE = {} as SupabaseClient;

function makeSources(tag: string): AssembleSources {
  return {
    schedule: [],
    transitionsByDate: new Map(),
    assignmentsByDate: new Map(),
    travelLegsByDate: new Map(),
    settingsMap: new Map([[tag, { detailLevel: "none" }]]),
  };
}

function makeFetcher(values: AssembleSources[]): {
  fetcher: (s: SupabaseClient, t: string) => Promise<AssembleSources>;
  callCount: () => number;
} {
  let i = 0;
  let calls = 0;
  return {
    fetcher: async () => {
      calls++;
      const v = values[Math.min(i, values.length - 1)];
      i++;
      return v;
    },
    callCount: () => calls,
  };
}

describe("fetchAllLiveSourcesCached — FRESH hit", () => {
  test("first call fetches; second call within FRESH_MS returns cached value", async () => {
    const sourcesA = makeSources("A");
    const { fetcher, callCount } = makeFetcher([sourcesA]);
    let now = 1_000_000;

    const r1 = await _fetchAllLiveSourcesCachedForTest(
      STUB_SUPABASE,
      "2026-04-28",
      fetcher,
      () => now
    );
    expect(r1).toBe(sourcesA);
    expect(callCount()).toBe(1);

    now += FRESH_MS - 1; // still fresh
    const r2 = await _fetchAllLiveSourcesCachedForTest(
      STUB_SUPABASE,
      "2026-04-28",
      fetcher,
      () => now
    );
    expect(r2).toBe(sourcesA);
    expect(callCount()).toBe(1); // no second fetch
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun test src/lib/snapshot/live-cache.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the minimum to pass the FRESH-hit test**

Create `src/lib/snapshot/live-cache.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssembleSources } from "./assemble";
import { fetchAllLiveSources } from "./freeze";

export const FRESH_MS = 10_000;
export const STALE_MS = 60_000;

type CacheEntry = {
  today: string;
  fetchedAt: number;
  refreshing: boolean;
  value: AssembleSources;
  pendingFetch: Promise<AssembleSources> | null;
};

let cache: CacheEntry | null = null;

export function invalidateLiveSourcesCache(): void {
  cache = null;
}

export function _resetForTest(): void {
  cache = null;
}

export function _peekForTest(): CacheEntry | null {
  return cache;
}

type Fetcher = (
  supabase: SupabaseClient,
  today: string
) => Promise<AssembleSources>;

export async function _fetchAllLiveSourcesCachedForTest(
  supabase: SupabaseClient,
  today: string,
  fetcher: Fetcher,
  now: () => number
): Promise<AssembleSources> {
  if (cache && cache.today === today) {
    const age = now() - cache.fetchedAt;
    if (age < FRESH_MS) {
      return cache.value;
    }
  }
  const value = await fetcher(supabase, today);
  cache = {
    today,
    fetchedAt: now(),
    refreshing: false,
    value,
    pendingFetch: null,
  };
  return value;
}

export function fetchAllLiveSourcesCached(
  supabase: SupabaseClient,
  today: string
): Promise<AssembleSources> {
  return _fetchAllLiveSourcesCachedForTest(
    supabase,
    today,
    fetchAllLiveSources,
    Date.now
  );
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun test src/lib/snapshot/live-cache.test.ts`
Expected: PASS — 1 test green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/snapshot/live-cache.ts src/lib/snapshot/live-cache.test.ts
git commit -m "feat(live-cache): FRESH-hit cache for fetchAllLiveSources"
```

---

### Task 6: STALE hit with background refresh (SWR)

**Files:**
- Modify: `src/lib/snapshot/live-cache.ts`
- Modify: `src/lib/snapshot/live-cache.test.ts`

- [ ] **Step 1: Add the STALE-hit test**

Append to `src/lib/snapshot/live-cache.test.ts` (inside the existing `describe` blocks at file scope):

```ts
describe("fetchAllLiveSourcesCached — STALE hit (SWR)", () => {
  test("call between FRESH_MS and STALE_MS returns stale value AND triggers background refresh", async () => {
    const sourcesA = makeSources("A");
    const sourcesB = makeSources("B");
    const { fetcher, callCount } = makeFetcher([sourcesA, sourcesB]);
    let now = 1_000_000;

    // First call — populates cache.
    await _fetchAllLiveSourcesCachedForTest(
      STUB_SUPABASE,
      "2026-04-28",
      fetcher,
      () => now
    );
    expect(callCount()).toBe(1);

    // Advance into the stale window.
    now += FRESH_MS + 1;

    const r2 = await _fetchAllLiveSourcesCachedForTest(
      STUB_SUPABASE,
      "2026-04-28",
      fetcher,
      () => now
    );
    expect(r2).toBe(sourcesA); // STALE hit returns the OLD value immediately.

    // Background refresh has been kicked off. Wait for it to complete.
    // We yield to the microtask queue twice: once for the stub fetcher's
    // own promise, once for the .then handler that writes back to cache.
    await Promise.resolve();
    await Promise.resolve();

    expect(callCount()).toBe(2); // background fetch ran.
    const peeked = _peekForTest();
    expect(peeked?.value).toBe(sourcesB); // cache now has the fresh value.
    expect(peeked?.refreshing).toBe(false);
  });

  test("multiple STALE hits do not stack background refreshes", async () => {
    const sourcesA = makeSources("A");
    const sourcesB = makeSources("B");
    const { fetcher, callCount } = makeFetcher([sourcesA, sourcesB]);
    let now = 1_000_000;

    await _fetchAllLiveSourcesCachedForTest(STUB_SUPABASE, "2026-04-28", fetcher, () => now);
    expect(callCount()).toBe(1);

    now += FRESH_MS + 1;
    // Three rapid STALE-hit calls before the background refresh resolves.
    await _fetchAllLiveSourcesCachedForTest(STUB_SUPABASE, "2026-04-28", fetcher, () => now);
    await _fetchAllLiveSourcesCachedForTest(STUB_SUPABASE, "2026-04-28", fetcher, () => now);
    await _fetchAllLiveSourcesCachedForTest(STUB_SUPABASE, "2026-04-28", fetcher, () => now);

    // Only one background refresh in flight.
    expect(callCount()).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `bun test src/lib/snapshot/live-cache.test.ts`
Expected: FAIL — current implementation always sync-fetches when not FRESH.

- [ ] **Step 3: Add STALE-hit logic**

In `src/lib/snapshot/live-cache.ts`, replace the body of `_fetchAllLiveSourcesCachedForTest` with:

```ts
export async function _fetchAllLiveSourcesCachedForTest(
  supabase: SupabaseClient,
  today: string,
  fetcher: Fetcher,
  now: () => number
): Promise<AssembleSources> {
  if (cache && cache.today === today) {
    const age = now() - cache.fetchedAt;
    if (age < FRESH_MS) {
      return cache.value;
    }
    if (age < STALE_MS) {
      kickOffBackgroundRefresh(supabase, today, fetcher, now);
      return cache.value;
    }
  }
  const value = await fetcher(supabase, today);
  cache = {
    today,
    fetchedAt: now(),
    refreshing: false,
    value,
    pendingFetch: null,
  };
  return value;
}

function kickOffBackgroundRefresh(
  supabase: SupabaseClient,
  today: string,
  fetcher: Fetcher,
  now: () => number
): void {
  if (!cache || cache.refreshing) return;
  cache.refreshing = true;
  fetcher(supabase, today)
    .then((value) => {
      // Guard against day-rollover during the in-flight refresh: if the
      // cached `today` no longer matches what we fetched for, drop the result.
      if (!cache || cache.today !== today) return;
      cache = {
        today,
        fetchedAt: now(),
        refreshing: false,
        value,
        pendingFetch: null,
      };
    })
    .catch((err) => {
      console.error("[live-cache] background refresh failed:", err);
      if (cache) cache.refreshing = false;
    });
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bun test src/lib/snapshot/live-cache.test.ts`
Expected: PASS — all FRESH and STALE tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/snapshot/live-cache.ts src/lib/snapshot/live-cache.test.ts
git commit -m "feat(live-cache): SWR background refresh in stale window"
```

---

### Task 7: Sync miss after STALE_MS

**Files:**
- Modify: `src/lib/snapshot/live-cache.test.ts`

The current implementation already falls through to the `await fetcher(...)` path when the entry is older than `STALE_MS`. This task locks that behavior in with a test.

- [ ] **Step 1: Add the test**

Append to `src/lib/snapshot/live-cache.test.ts`:

```ts
describe("fetchAllLiveSourcesCached — sync miss after STALE_MS", () => {
  test("call after STALE_MS sync-fetches and replaces the cache", async () => {
    const sourcesA = makeSources("A");
    const sourcesB = makeSources("B");
    const { fetcher, callCount } = makeFetcher([sourcesA, sourcesB]);
    let now = 1_000_000;

    await _fetchAllLiveSourcesCachedForTest(STUB_SUPABASE, "2026-04-28", fetcher, () => now);
    expect(callCount()).toBe(1);

    now += STALE_MS + 1;
    const r = await _fetchAllLiveSourcesCachedForTest(STUB_SUPABASE, "2026-04-28", fetcher, () => now);
    expect(r).toBe(sourcesB); // got the FRESH value, not the old A.
    expect(callCount()).toBe(2);
  });
});
```

- [ ] **Step 2: Run and confirm it passes (no implementation needed)**

Run: `bun test src/lib/snapshot/live-cache.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/snapshot/live-cache.test.ts
git commit -m "test(live-cache): cover sync-miss after STALE_MS"
```

---

### Task 8: Concurrent-miss dedupe

**Files:**
- Modify: `src/lib/snapshot/live-cache.ts`
- Modify: `src/lib/snapshot/live-cache.test.ts`

Two parallel calls arriving while the cache is empty currently fan out into two `fetcher` invocations. Add a `pendingFetch` promise so concurrent callers share one fetch.

- [ ] **Step 1: Add the test**

Append to `src/lib/snapshot/live-cache.test.ts`:

```ts
describe("fetchAllLiveSourcesCached — concurrent miss dedupe", () => {
  test("two parallel calls during a cold miss share one fetch", async () => {
    const sourcesA = makeSources("A");
    let resolve!: (v: AssembleSources) => void;
    let calls = 0;
    const fetcher: (s: SupabaseClient, t: string) => Promise<AssembleSources> = () => {
      calls++;
      return new Promise<AssembleSources>((res) => {
        resolve = res;
      });
    };
    const now = () => 1_000_000;

    const p1 = _fetchAllLiveSourcesCachedForTest(STUB_SUPABASE, "2026-04-28", fetcher, now);
    const p2 = _fetchAllLiveSourcesCachedForTest(STUB_SUPABASE, "2026-04-28", fetcher, now);

    expect(calls).toBe(1); // both callers share one fetch.

    resolve(sourcesA);
    expect(await p1).toBe(sourcesA);
    expect(await p2).toBe(sourcesA);
    expect(calls).toBe(1);
  });

  test("a fetch failure does not pin the cache; next caller retries", async () => {
    let calls = 0;
    let mode: "fail" | "succeed" = "fail";
    const sourcesA = makeSources("A");
    const fetcher: (s: SupabaseClient, t: string) => Promise<AssembleSources> = async () => {
      calls++;
      if (mode === "fail") throw new Error("boom");
      return sourcesA;
    };
    const now = () => 1_000_000;

    await expect(
      _fetchAllLiveSourcesCachedForTest(STUB_SUPABASE, "2026-04-28", fetcher, now)
    ).rejects.toThrow("boom");
    expect(_peekForTest()).toBeNull();

    mode = "succeed";
    const r = await _fetchAllLiveSourcesCachedForTest(STUB_SUPABASE, "2026-04-28", fetcher, now);
    expect(r).toBe(sourcesA);
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 2: Run and confirm the dedupe test fails**

Run: `bun test src/lib/snapshot/live-cache.test.ts`
Expected: FAIL — first dedupe test sees `calls === 2` (no dedupe yet).

- [ ] **Step 3: Implement the dedupe**

In `src/lib/snapshot/live-cache.ts`, replace `_fetchAllLiveSourcesCachedForTest` with:

```ts
export async function _fetchAllLiveSourcesCachedForTest(
  supabase: SupabaseClient,
  today: string,
  fetcher: Fetcher,
  now: () => number
): Promise<AssembleSources> {
  if (cache && cache.today === today) {
    const age = now() - cache.fetchedAt;
    if (age < FRESH_MS) {
      return cache.value;
    }
    if (age < STALE_MS) {
      kickOffBackgroundRefresh(supabase, today, fetcher, now);
      return cache.value;
    }
  }

  // Concurrent-miss dedupe: if a fetch is already in flight for this `today`,
  // share its promise rather than fanning out a second call.
  if (cache && cache.today === today && cache.pendingFetch) {
    return cache.pendingFetch;
  }

  const promise = fetcher(supabase, today);
  cache = {
    today,
    fetchedAt: 0, // not yet finalized — will be set on success.
    refreshing: false,
    value: undefined as unknown as AssembleSources,
    pendingFetch: promise,
  };
  try {
    const value = await promise;
    cache = {
      today,
      fetchedAt: now(),
      refreshing: false,
      value,
      pendingFetch: null,
    };
    return value;
  } catch (err) {
    cache = null; // don't pin a failure — next caller retries.
    throw err;
  }
}
```

- [ ] **Step 4: Run and confirm both tests pass**

Run: `bun test src/lib/snapshot/live-cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/snapshot/live-cache.ts src/lib/snapshot/live-cache.test.ts
git commit -m "feat(live-cache): dedupe concurrent cold-miss fetches"
```

---

### Task 9: Day rollover busts the cache

**Files:**
- Modify: `src/lib/snapshot/live-cache.test.ts`

The existing `cache.today === today` check already handles this, but lock it in with a test.

- [ ] **Step 1: Add the test**

Append to `src/lib/snapshot/live-cache.test.ts`:

```ts
describe("fetchAllLiveSourcesCached — day rollover", () => {
  test("when today changes, treat as a miss and refetch", async () => {
    const day1 = makeSources("day1");
    const day2 = makeSources("day2");
    const { fetcher, callCount } = makeFetcher([day1, day2]);
    let now = 1_000_000;

    await _fetchAllLiveSourcesCachedForTest(STUB_SUPABASE, "2026-04-28", fetcher, () => now);
    expect(callCount()).toBe(1);

    // Same time, but today has rolled over.
    const r = await _fetchAllLiveSourcesCachedForTest(STUB_SUPABASE, "2026-04-29", fetcher, () => now);
    expect(r).toBe(day2);
    expect(callCount()).toBe(2);
    expect(_peekForTest()?.today).toBe("2026-04-29");
  });
});
```

- [ ] **Step 2: Run and confirm it passes (no implementation needed)**

Run: `bun test src/lib/snapshot/live-cache.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/snapshot/live-cache.test.ts
git commit -m "test(live-cache): cover day-rollover invalidation"
```

---

### Task 10: Manual invalidate on mutations

**Files:**
- Modify: `src/lib/snapshot/live-cache.test.ts`

`invalidateLiveSourcesCache` is already exported. Lock its behavior in with a test.

- [ ] **Step 1: Add the test**

Append to `src/lib/snapshot/live-cache.test.ts`:

```ts
describe("invalidateLiveSourcesCache", () => {
  test("clears the cache so the next call sync-fetches", async () => {
    const sourcesA = makeSources("A");
    const sourcesB = makeSources("B");
    const { fetcher, callCount } = makeFetcher([sourcesA, sourcesB]);
    const now = () => 1_000_000;

    await _fetchAllLiveSourcesCachedForTest(STUB_SUPABASE, "2026-04-28", fetcher, now);
    expect(callCount()).toBe(1);

    invalidateLiveSourcesCache();
    expect(_peekForTest()).toBeNull();

    const r = await _fetchAllLiveSourcesCachedForTest(STUB_SUPABASE, "2026-04-28", fetcher, now);
    expect(r).toBe(sourcesB);
    expect(callCount()).toBe(2);
  });
});
```

- [ ] **Step 2: Run and confirm it passes (no implementation needed)**

Run: `bun test src/lib/snapshot/live-cache.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/snapshot/live-cache.test.ts
git commit -m "test(live-cache): cover manual invalidate"
```

---

### Task 11: Wire the cache into `dashboard/page.tsx`

**Files:**
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Swap the import and call site**

In `src/app/dashboard/page.tsx`, change line 22 from:

```ts
import { fetchAllLiveSources, runSnapshotForDates } from "@/lib/snapshot/freeze";
```

to:

```ts
import { runSnapshotForDates } from "@/lib/snapshot/freeze";
import { fetchAllLiveSourcesCached } from "@/lib/snapshot/live-cache";
```

Then on line 73 change:

```ts
    ? fetchAllLiveSources(supabase, today).catch((err) => {
```

to:

```ts
    ? fetchAllLiveSourcesCached(supabase, today).catch((err) => {
```

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat(dashboard): use cached fetchAllLiveSources"
```

---

### Task 12: Bust the cache on every dashboard mutation

**Files:**
- Modify: `src/app/dashboard/actions.ts`

Six server actions write to data the live sources read from. Each currently calls `revalidatePath("/dashboard")` after success — we add `invalidateLiveSourcesCache()` next to it. The two calls do different jobs: `revalidatePath` busts Next.js's RSC cache; `invalidateLiveSourcesCache` busts our in-memory live-sources cache. Both are needed for the next dashboard load to see the write.

- [ ] **Step 1: Add the import**

At the top of `src/app/dashboard/actions.ts`, alongside the other imports:

```ts
import { invalidateLiveSourcesCache } from "@/lib/snapshot/live-cache";
```

- [ ] **Step 2: Add `invalidateLiveSourcesCache()` to all six wrappers**

Edit each of the six exported wrappers (`assignEpo`, `unassignEpo`, `setDetailLevel`, `createTravelLeg`, `updateTravelLeg`, `deleteTravelLeg`). Each currently looks like:

```ts
  if (result.ok) revalidatePath("/dashboard");
  return result;
```

Change each to:

```ts
  if (result.ok) {
    invalidateLiveSourcesCache();
    revalidatePath("/dashboard");
  }
  return result;
```

(Order matters slightly: invalidate the cache *before* `revalidatePath`, so any RSC re-render kicked off by the revalidation sees an empty cache and refetches.)

- [ ] **Step 3: Type-check and run the existing actions test suite**

Run: `bunx tsc --noEmit`
Expected: clean.

Run: `bun test src/app/dashboard/actions.test.ts`
Expected: PASS — existing tests still green. The `_*ForTest` paths skip the wrappers entirely and don't touch the cache, so behavior is unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/actions.ts
git commit -m "feat(dashboard-actions): invalidate live-sources cache on mutation"
```

---

### Task 13: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `bun run dev`

- [ ] **Step 2: Verify Phase 1 (pills are instant)**

Open the dashboard. With DevTools → Network → filter "Fetch/XHR" open:
- Click each filter pill in turn.
- Expected: NO `?_rsc=` request fires. Entries narrow instantly. URL updates in the address bar.

- [ ] **Step 3: Verify Phase 2 fresh hit (rapid range changes)**

- Pick a custom range. Network shows one RSC request, ~1-3s.
- Within 10 s, pick a slightly different range. Expected: RSC request fires (the dashboard still re-renders) but the response comes back fast — no Sheets/Calendar latency. Look at the response timing.
- A reliable way to see the cache working: add a temporary `console.log("[live-cache] sync miss")` to the sync-miss branch, run two range changes within 10 s, verify only ONE log line appears. Remove the log before commit.

- [ ] **Step 4: Verify Phase 2 freshness (mutations bust the cache)**

- As management, assign an EPO to a date.
- Refresh / re-navigate the dashboard.
- Expected: the new assignment appears immediately (not after a 10 s wait).

- [ ] **Step 5: Verify Phase 2 staleness bound**

- Load the dashboard. Note the time.
- Edit the Google Sheet directly (e.g., change a date's `Activity`).
- Wait ~12 s, then click any pill or refresh the dashboard.
- Expected: within ~10–20 s of the next interaction, the edit is visible.

- [ ] **Step 6: Final test sweep**

Run: `bun test`
Expected: all tests green, including the new `filter-url` and `live-cache` suites and the existing `actions`, `range`, `freeze`, `assemble`, etc.

Run: `bun run lint`
Expected: clean.

Run: `bun run build`
Expected: clean Next.js production build.

- [ ] **Step 7: No further commit needed.**

If any check fails, fix and commit before considering the plan complete.

---

## Self-Review Notes

- **Spec coverage:** Phase 1 (pills client-side, replaceState URL sync) is implemented in Tasks 1–4. Phase 2 (cache state machine with FRESH / STALE+SWR / sync miss / dedupe / day-rollover / manual invalidate, wired into page.tsx and actions.ts) is implemented in Tasks 5–12. The spec's "shared filter.ts predicates module" was dropped as YAGNI (documented under Deviations); EPO and Management filters live inline in their respective dashboards. End-to-end manual verification is Task 13.
- **Risk acknowledgment:** The biggest assumption is that `window.history.replaceState` does NOT trigger a server component re-run in Next.js 16. Task 4 step 3 checks this directly via DevTools Network. If wrong, the perf goal isn't met and we need to revisit (likely: bring filter state fully out of URL).
- **Type/name consistency:** `FilterOption` is the same union throughout. `FRESH_MS` / `STALE_MS` are consistent constants. `fetchAllLiveSourcesCached` and `invalidateLiveSourcesCache` are the only new public exports from `live-cache.ts`.
