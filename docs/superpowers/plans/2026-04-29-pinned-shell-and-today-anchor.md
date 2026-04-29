# Pinned Shell and Today Anchor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin the header and filter row while only the card list scrolls; on load, anchor the today card (or the next-upcoming card) at the top of the scrollable region; show a "TODAY" banner with smooth jump-back when today scrolls out of view; rely on native iOS document-scroll rubber-band for the elastic "bump" feel.

**Architecture:** Single document scroll with `position: sticky` on a wrapper containing header + filter row + conditional banner. A pure helper resolves which entry should receive the anchor ref. Two hooks wrap `scrollIntoView` and `IntersectionObserver` glue. Both `epo-dashboard.tsx` and `management-dashboard.tsx` use the same pieces.

**Tech Stack:** Next.js 16.2.1 (App Router), React 19.2.4, TypeScript 5, Tailwind 4, `bun test` (`bun:test` API).

**Spec:** `docs/superpowers/specs/2026-04-29-pinned-shell-and-today-anchor-design.md`

**Deviations from spec:**
- The spec lists component-level render tests for `<TodayBanner>` and integration tests in the dashboard test files. **This codebase does not have a React testing library installed** (no `@testing-library/react`, no `react-test-renderer`, no jsdom). All existing tests are pure-logic tests via `bun:test` (see `src/lib/dashboard/filter-url.test.ts`, `src/lib/snapshot/live-cache.test.ts`, etc.). Adding a React testing stack just for this plan is scope creep. **Plan tests the pure helper (`findAnchorDate`) and verifies UI behavior via manual browser flows**, matching the convention used in the recent `dashboard-filter-performance` plan.
- Hooks (`useTodayAnchor`, `useElementOffScreen`) are not unit-tested. Their behavior is small (one `useEffect` each) and tied to DOM APIs (`scrollIntoView`, `IntersectionObserver`) that need a real browser to exercise meaningfully. They are validated in Task 6's manual verification.
- The spec lists three separate sticky elements with z-stack `header(30) > filters(20) > banner(10)`. The plan combines header + filters into a single `sticky top-0 z-30` wrapper (one element), with the banner as a separate `sticky top-32 z-20` element. Functionally equivalent — three pinned regions become two — and avoids per-element offset math (`top-[HEADER_H]`). The chrome wrapper's height is what `top-32` / `scroll-mt-32` is sized for.

---

## File Structure

**New files:**
- `src/lib/dashboard/today-anchor.ts` — pure `findAnchorDate` helper. One responsibility: given an array of entries and `todayISO`, return the date that should receive the anchor ref (or `null`).
- `src/lib/dashboard/today-anchor.test.ts` — unit tests for the helper.
- `src/lib/hooks/use-today-anchor.ts` — `useTodayAnchor` and `useElementOffScreen` hooks (small, paired, one file).
- `src/components/today-banner.tsx` — `<TodayBanner>` presentational component.

**Modified files:**
- `src/app/dashboard/epo-dashboard.tsx` — wrap header + filters + banner in sticky chrome; resolve anchor via helper; wire banner.
- `src/app/dashboard/management-dashboard.tsx` — same shape as EPO dashboard.

The dashboards share enough of the new shell that you may be tempted to extract a `<DashboardShell>` component. **Don't.** They have different headers (EPO has user name + Sign Out + Bug; Management has "Manage Users" link + Sign Out + Bug), different filter sets, and different card components. The shared parts (sticky wrapping, anchor wiring, banner) are ~10 lines per dashboard — extracting them obscures more than it saves. YAGNI.

---

## Task 1: Pure anchor-date helper

**Files:**
- Create: `src/lib/dashboard/today-anchor.ts`
- Test: `src/lib/dashboard/today-anchor.test.ts`

The dashboard needs to resolve which card should receive the anchor ref. The rule (from the spec, "Initial load" section):
1. If a card with `entry.date === todayISO` exists in the filtered set → that one.
2. Else, if any card has `entry.date >= todayISO` → the smallest such date (next-upcoming).
3. Else → `null` (no anchoring; e.g., EPO viewing `Past Assignments`).

The function also needs to tell the caller whether the anchor *is* today (so the banner can render) or *isn't* today (banner stays hidden — there's no "today" to jump to).

The input array is *not guaranteed sorted* in all dashboards — `epo-dashboard.tsx` filters then keeps order, and `page.tsx:163` does sort the assembled list, but the EPO `filtered` may be reduced further. Don't assume sortedness. Test for it.

- [ ] **Step 1: Write the failing test file**

Create `src/lib/dashboard/today-anchor.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { findAnchorDate } from "./today-anchor";

type E = { date: string };

describe("findAnchorDate", () => {
  test("returns null for empty input", () => {
    expect(findAnchorDate([], "2026-04-29")).toEqual({ date: null, isToday: false });
  });

  test("returns today when today is in the set", () => {
    const entries: E[] = [
      { date: "2026-04-27" },
      { date: "2026-04-28" },
      { date: "2026-04-29" },
      { date: "2026-04-30" },
    ];
    expect(findAnchorDate(entries, "2026-04-29")).toEqual({
      date: "2026-04-29",
      isToday: true,
    });
  });

  test("returns the next-upcoming date when today is missing", () => {
    const entries: E[] = [
      { date: "2026-04-27" },
      { date: "2026-04-28" },
      { date: "2026-05-02" },
      { date: "2026-05-04" },
    ];
    expect(findAnchorDate(entries, "2026-04-29")).toEqual({
      date: "2026-05-02",
      isToday: false,
    });
  });

  test("returns null when all entries are in the past", () => {
    const entries: E[] = [
      { date: "2026-04-26" },
      { date: "2026-04-27" },
      { date: "2026-04-28" },
    ];
    expect(findAnchorDate(entries, "2026-04-29")).toEqual({ date: null, isToday: false });
  });

  test("works on unsorted input", () => {
    const entries: E[] = [
      { date: "2026-05-04" },
      { date: "2026-04-27" },
      { date: "2026-05-02" },
      { date: "2026-04-28" },
    ];
    // today is missing, smallest >= today is 2026-05-02
    expect(findAnchorDate(entries, "2026-04-29")).toEqual({
      date: "2026-05-02",
      isToday: false,
    });
  });

  test("today match wins over earlier matches in array order", () => {
    // Even if a future date appears before today in the array, today should win.
    const entries: E[] = [
      { date: "2026-05-10" },
      { date: "2026-04-29" },
      { date: "2026-05-02" },
    ];
    expect(findAnchorDate(entries, "2026-04-29")).toEqual({
      date: "2026-04-29",
      isToday: true,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/lib/dashboard/today-anchor.test.ts`
Expected: FAIL with `Cannot find module './today-anchor'` or similar import error.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/dashboard/today-anchor.ts`:

```ts
/**
 * Resolve the entry that should receive the scroll anchor on dashboard load.
 *
 * - If today is in the set, anchor today and tell the caller it IS today
 *   (so the banner will render when today scrolls off-screen).
 * - Otherwise, anchor the next-upcoming entry (smallest date >= todayISO)
 *   and tell the caller it is NOT today (banner stays hidden — there is no
 *   "today" to jump back to).
 * - If nothing in the set is today or future, return null (no anchoring).
 *
 * Input is not assumed sorted. EPO filter passes can produce out-of-order
 * sets relative to the original assembly.
 */
export function findAnchorDate<T extends { date: string }>(
  entries: ReadonlyArray<T>,
  todayISO: string,
): { date: string | null; isToday: boolean } {
  let nextUpcoming: string | null = null;
  for (const e of entries) {
    if (e.date === todayISO) {
      return { date: todayISO, isToday: true };
    }
    if (e.date > todayISO && (nextUpcoming === null || e.date < nextUpcoming)) {
      nextUpcoming = e.date;
    }
  }
  return { date: nextUpcoming, isToday: false };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/lib/dashboard/today-anchor.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard/today-anchor.ts src/lib/dashboard/today-anchor.test.ts
git commit -m "feat(dashboard): add findAnchorDate helper for today-anchor logic"
```

---

## Task 2: TodayBanner component

**Files:**
- Create: `src/components/today-banner.tsx`

Pure presentational component. No internal state, no effects. The parent owns visibility and click handling. Styled to match the existing active filter pill (`bg-blue-900/60 text-blue-400`) for visual consistency.

The component returns `null` when not visible so the sticky slot collapses cleanly — important so the cards sit flush against the filter row when no banner is showing.

- [ ] **Step 1: Read existing pill/badge styling**

Read `src/components/dashboard-filters.tsx:59-63` to confirm the active pill class names. The banner should look like a wider, full-width version of an active pill.

- [ ] **Step 2: Create the component**

Create `src/components/today-banner.tsx`:

```tsx
"use client";

import { formatDateHeader } from "@/lib/schedule-utils";

type Props = {
  todayISO: string;
  tomorrowISO: string;
  visible: boolean;
  onJumpToToday: () => void;
};

export function TodayBanner({ todayISO, tomorrowISO, visible, onJumpToToday }: Props) {
  if (!visible) return null;
  const label = formatDateHeader(todayISO, todayISO, tomorrowISO);
  return (
    <button
      type="button"
      onClick={onJumpToToday}
      className="flex w-full items-center justify-between rounded-md bg-blue-900/60 px-3 py-1.5 text-xs text-blue-400 transition-colors hover:bg-blue-900/80"
      aria-label="Jump to today"
    >
      <span className="font-medium uppercase tracking-wide">{label}</span>
      <span aria-hidden className="text-[10px] opacity-70">↓ jump</span>
    </button>
  );
}
```

Notes:
- `formatDateHeader(todayISO, todayISO, tomorrowISO)` returns the user-facing "Today" label (the existing helper in `schedule-utils.ts` recognises today and tomorrow specially).
- It's a `<button>` not a `<div>` — the whole bar is clickable, and `<button>` gives free keyboard activation + focus styles.

- [ ] **Step 3: Type-check**

Run: `bunx tsc --noEmit`
Expected: PASS (no type errors).

- [ ] **Step 4: Commit**

```bash
git add src/components/today-banner.tsx
git commit -m "feat(dashboard): add TodayBanner component"
```

---

## Task 3: useTodayAnchor and useElementOffScreen hooks

**Files:**
- Create: `src/lib/hooks/use-today-anchor.ts`

Two small hooks in one file (they're paired and short — one file is clearer than two).

`useTodayAnchor` runs an effect on mount and whenever its `deps` change. If the ref is attached, it scrolls the element into view at the top of the viewport. Auto-anchor uses `behavior: "auto"` (instant — no visible scroll on mount or filter swap). The returned `jumpToToday` uses `behavior: "smooth"` (deliberate, post-banner-click).

`useElementOffScreen` uses `IntersectionObserver` with a negative top `rootMargin` matching the sticky stack height — so "off-screen" means "above the visible cards window," not "behind the sticky chrome." Returns a boolean.

- [ ] **Step 1: Create the hooks file**

Create `src/lib/hooks/use-today-anchor.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Scroll the referenced element into view at the top of the scrollable region.
 *
 * - On mount and whenever `deps` change, if `ref.current` is non-null, do an
 *   instant scroll to the element. Used for initial anchor + re-anchor on
 *   filter/range change.
 * - The `jumpToToday` returned function does a SMOOTH scroll. Used by the
 *   banner click — distinct UX from the silent initial anchor.
 * - The sticky-stack offset is handled via `scroll-margin-top` set in CSS on
 *   the anchor element (see TASK_4 wiring). Keeping pixel math out of JS
 *   means the hook stays DOM-agnostic.
 *
 * No-op when ref is null (today not in current filter result).
 */
export function useTodayAnchor(
  ref: React.RefObject<HTMLElement | null>,
  deps: ReadonlyArray<unknown>,
): { jumpToToday: () => void } {
  // Auto-anchor on mount + dep change.
  useEffect(() => {
    if (!ref.current) return;
    ref.current.scrollIntoView({ block: "start", behavior: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const jumpToToday = useCallback(() => {
    if (!ref.current) return;
    ref.current.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [ref]);

  return { jumpToToday };
}

/**
 * Returns true when the referenced element is NOT intersecting the viewport.
 *
 * `topOffsetPx` shrinks the effective viewport from the top so an element
 * that's behind the sticky header/filter chrome counts as "off-screen."
 *
 * Returns `false` until the first observer callback fires (avoids a flash
 * of the banner before we know the answer).
 */
export function useElementOffScreen(
  ref: React.RefObject<HTMLElement | null>,
  topOffsetPx: number,
): boolean {
  const [offScreen, setOffScreen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setOffScreen(!entry.isIntersecting);
      },
      {
        // Negative top inset: the element must be visible BELOW the sticky
        // chrome to count as "intersecting".
        rootMargin: `-${topOffsetPx}px 0px 0px 0px`,
        threshold: 0,
      },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, topOffsetPx]);

  return offScreen;
}

/** Helper: typed ref + initial null. Saves boilerplate at call sites. */
export function useAnchorRef<T extends HTMLElement = HTMLDivElement>() {
  return useRef<T | null>(null);
}
```

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/hooks/use-today-anchor.ts
git commit -m "feat(dashboard): add useTodayAnchor and useElementOffScreen hooks"
```

---

## Task 4: Wire EPO dashboard

**Files:**
- Modify: `src/app/dashboard/epo-dashboard.tsx`

The wiring:
1. Move the `py-6` top padding off the outer wrapper so the sticky chrome can pin flush to viewport top.
2. Wrap header + filters in a single `sticky top-0 z-30` container with the page background. This is the chrome that pins.
3. Add `<TodayBanner>` *outside* that wrapper but with its own sticky position one step below (so its show/hide does not change the height of the chrome wrapper).
4. Resolve the anchor entry via `findAnchorDate(filtered, todayISO)`.
5. Attach an anchor ref + `scroll-mt-*` class to the matching card.
6. Drive the banner with `useElementOffScreen`.

The EPO dashboard's default `My Assignments` filter already excludes past dates (line 51), so today (or next-upcoming) is normally at the top of the list. The bump-against-snapshots scenario doesn't really apply here — but the same chrome and anchor wiring still gives a consistent UX across both dashboards.

**Sticky stack height:** the chrome wrapper needs a fixed height so the cards' `scroll-mt` and the banner's `top` offset can match. After this change the wrapper contains: page top padding (24px) + header (~52px content + 16px mb) + filters (~32px). Round to **128px** (`top-32` Tailwind). The banner sits at `top-32` too (it appears below the chrome). The today card uses `scroll-mt-32` so when scrolled into view it lands just below the chrome.

> If during manual verification (Task 6) the chrome ends up taller (e.g., filters wrap on narrow screens), bump the values to `top-40` / `scroll-mt-40` consistently.

- [ ] **Step 1: Read the current file**

Read `src/app/dashboard/epo-dashboard.tsx` end-to-end. Note:
- Line 77: outer wrapper className.
- Lines 78-89: header.
- Lines 91-98: filters wrapper with `mb-4`.
- Lines 113-127: card list rendering.

- [ ] **Step 2: Apply the wiring**

Two edits to `src/app/dashboard/epo-dashboard.tsx`:

**(a)** Add these imports after the existing `DashboardFilters` import (lines 11-13):

```tsx
import { findAnchorDate } from "@/lib/dashboard/today-anchor";
import {
  useAnchorRef,
  useElementOffScreen,
  useTodayAnchor,
} from "@/lib/hooks/use-today-anchor";
import { TodayBanner } from "@/components/today-banner";
```

(`useMemo` is already imported on line 3 — no React import changes needed.)

**(b)** Replace everything from immediately after the existing `filtered` `useMemo` (currently ending at line 74) through the closing `}` of the function (line 130) with the block below. This block adds the hook calls then renders the new sticky chrome + banner + cards:

```tsx
  const anchor = useMemo(
    () => findAnchorDate(filtered, todayISO),
    [filtered, todayISO],
  );
  const anchorRef = useAnchorRef<HTMLDivElement>();
  const { jumpToToday } = useTodayAnchor(anchorRef, [
    anchor.date,
    filtered.length,
    filter,
  ]);
  // Banner only listens when the anchor IS today. When the anchor is the
  // next-upcoming card, there is no "today" to jump to.
  const todayCardOffScreen = useElementOffScreen(
    anchor.isToday ? anchorRef : { current: null },
    128,
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-6">
      <div className="sticky top-0 z-30 bg-black pt-6">
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
          />
        </div>
      </div>

      <div className="sticky top-32 z-20 bg-black pb-2">
        <TodayBanner
          todayISO={todayISO}
          tomorrowISO={tomorrowISO}
          visible={anchor.isToday && todayCardOffScreen}
          onJumpToToday={jumpToToday}
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
          {filtered.map((entry) => {
            const isAnchor = entry.date === anchor.date;
            return (
              <div
                key={entry.date}
                ref={isAnchor ? anchorRef : undefined}
                className={`space-y-2 ${isAnchor ? "scroll-mt-32" : ""}`}
              >
                <DateHeader
                  dateStr={entry.date}
                  status={entry.confirmationStatus}
                  todayISO={todayISO}
                  tomorrowISO={tomorrowISO}
                />
                <ScheduleDetailCard entry={entry} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
```

- [ ] **Step 3: Type-check**

Run: `bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Lint**

Run: `bun run lint`
Expected: PASS (no new warnings).

- [ ] **Step 5: Build**

Run: `bun run build`
Expected: PASS.

- [ ] **Step 6: Manual smoke (dev server)**

Run: `bun run dev`
Open `http://localhost:3000/dashboard` (logged in as an EPO).
Verify (visual only — full cross-platform verification is Task 6):
- Header and filter row stay pinned when you scroll the cards.
- On `My Assignments` filter, today (or next assignment) is at the top of the visible card area.
- Switch to `Past Assignments` — list re-anchors to top, no banner.
- Switch back — re-anchors to today.

Stop the dev server when satisfied.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/epo-dashboard.tsx
git commit -m "feat(dashboard): pin chrome and anchor today on EPO dashboard"
```

---

## Task 5: Wire management dashboard

**Files:**
- Modify: `src/app/dashboard/management-dashboard.tsx`

Same shape as Task 4. The management dashboard has the more interesting case — its default range is `today−2..today+30` (per `parseRangeFromSearchParams` in `src/lib/dashboard/range.ts`, with a 2-day past lookback for management to surface recent snapshots). On load, the anchor lands today, leaving the two snapshot days above for the user to scroll up into. Past those, the document scroll hits its top → iOS rubber-bands.

- [ ] **Step 1: Read the current file**

Read `src/app/dashboard/management-dashboard.tsx`. Same shape as EPO except: different header (Manage Users link), `ManagementCard` instead of `ScheduleDetailCard`, no `assignedDates` filter.

- [ ] **Step 2: Apply the wiring**

Add these imports after the existing `DashboardFilters` import (lines 10-13):

```tsx
import { findAnchorDate } from "@/lib/dashboard/today-anchor";
import {
  useAnchorRef,
  useElementOffScreen,
  useTodayAnchor,
} from "@/lib/hooks/use-today-anchor";
import { TodayBanner } from "@/components/today-banner";
```

Add these hook calls after the `filtered` `useMemo` (currently ending at line 60):

```tsx
  const anchor = useMemo(
    () => findAnchorDate(filtered, todayISO),
    [filtered, todayISO],
  );
  const anchorRef = useAnchorRef<HTMLDivElement>();
  const { jumpToToday } = useTodayAnchor(anchorRef, [
    anchor.date,
    filtered.length,
    filter,
  ]);
  const todayCardOffScreen = useElementOffScreen(
    anchor.isToday ? anchorRef : { current: null },
    128,
  );
```

Replace the return block (currently lines 62-122) with:

```tsx
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-6">
      <div className="sticky top-0 z-30 bg-black pt-6">
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
          />
        </div>
      </div>

      <div className="sticky top-32 z-20 bg-black pb-2">
        <TodayBanner
          todayISO={todayISO}
          tomorrowISO={tomorrowISO}
          visible={anchor.isToday && todayCardOffScreen}
          onJumpToToday={jumpToToday}
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
          {filtered.map((entry) => {
            const isAnchor = entry.date === anchor.date;
            return (
              <div
                key={entry.date}
                ref={isAnchor ? anchorRef : undefined}
                className={`space-y-2 ${isAnchor ? "scroll-mt-32" : ""}`}
              >
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
            );
          })}
        </div>
      )}
    </div>
  );
```

- [ ] **Step 3: Type-check**

Run: `bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Lint**

Run: `bun run lint`
Expected: PASS.

- [ ] **Step 5: Build**

Run: `bun run build`
Expected: PASS.

- [ ] **Step 6: Manual smoke (dev server)**

Run: `bun run dev`
Open `http://localhost:3000/dashboard` (logged in as management).
Verify:
- On load, today's card is at the top of the visible card area.
- Two snapshot cards exist above; scroll up to see them.
- Past the second snapshot card, the document scroll hits its top — on iOS this rubber-bands; on desktop it's a hard stop. Both fine.
- Header + filters stay pinned the whole time.
- Scroll well past today (downward); the TODAY banner appears once today's card has scrolled out of view. Click the banner — smooth scroll back to today; banner disappears.

Stop the dev server when satisfied.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/management-dashboard.tsx
git commit -m "feat(dashboard): pin chrome and anchor today on management dashboard"
```

---

## Task 6: Cross-platform manual verification

**Files:** none (manual testing).

The hooks and sticky behavior depend on platform-specific browser quirks (iOS Safari rubber-band, IntersectionObserver root margin, sticky stacking). Tasks 4 and 5 each had a smoke check on desktop; this task confirms the full flow on both platforms before merge.

- [ ] **Step 1: iOS Safari verification**

On a phone (or iOS Simulator → Safari) running the dev/preview build:

- Load EPO dashboard (default `My Assignments`):
  - Today (or next assignment) is at top of card area.
  - Header and filters pinned.
  - Scroll up past the top card — document rubber-bands and snaps back. ✅ Elastic bump.
  - Scroll down past today (need enough cards) — TODAY banner fades in once today is fully off-screen.
  - Tap banner — smooth scroll back to today; banner disappears.
- Load management dashboard:
  - Today is at top with two snapshot cards above (default range `today−2..today+30`).
  - Scroll up — first hit the snapshot cards, then past them the document rubber-bands. ✅ This is "graceful bump after the previous 2 days snapshot cards."
  - Scroll down past today — banner fades in.
  - Tap banner — smooth scroll back.
- Notch/safe area: header should not be hidden behind the iOS dynamic island / notch.

- [ ] **Step 2: Desktop Chrome verification**

Same flows. Differences expected:
- No native rubber-band on desktop document scroll; scroll up just hard-stops. Acceptable.
- Smooth scroll on banner click should be smooth.

- [ ] **Step 3: Filter-swap verification**

- EPO: All → Past Assignments → All. After each swap, verify the list anchors at the top (or at today on the swap back to All).
- Management: change date range via picker. Verify anchor re-applies to today if today is in the new range.

- [ ] **Step 4: Edge case — today has no card (EPO)**

Pick an EPO test user with no assignment for today, or temporarily remove their today assignment. Default `My Assignments` view should anchor at the next-upcoming assignment, and the TODAY banner should NEVER appear (regardless of how far you scroll), because there is no today card to jump back to.

- [ ] **Step 5: Tune sticky-stack height if needed**

If during any of the above the chrome looks too short (cards bleed under it) or too tall (extra gap above today on anchor), search-replace `top-32` → `top-40` and `scroll-mt-32` → `scroll-mt-40` (or vice versa) consistently across both dashboards. Re-verify.

- [ ] **Step 6: Commit any tuning fixes**

If Step 5 produced changes:

```bash
git add src/app/dashboard/epo-dashboard.tsx src/app/dashboard/management-dashboard.tsx
git commit -m "fix(dashboard): tune sticky-stack height for chrome+banner"
```

If no changes needed, skip.

---

## Self-Review (Spec Coverage Check)

| Spec requirement | Task |
|---|---|
| Header + filter row pinned, only cards scroll | Tasks 4, 5 (sticky wrapper) |
| Today (or next-upcoming) anchored at top on load | Task 1 (helper) + Task 4/5 (wiring) |
| Elastic bump scrolling past oldest card | Native iOS document scroll (no code) — verified Task 6 |
| Conditional TODAY banner | Task 2 (component) + Task 4/5 (wiring) |
| Banner click → smooth scroll back to today | Task 3 (`jumpToToday`) + Task 4/5 (wiring) |
| Auto-anchor instant; banner-click smooth | Task 3 (distinct `behavior` per path) |
| Banner stays hidden when today has no card | Task 4/5 (`anchor.isToday && todayCardOffScreen`) |
| Re-anchor on filter / range change | Task 3 (deps include filter + length) |
| Applies to both EPO and management dashboards | Tasks 4, 5 |
| iOS safe-area inset for header | Outer wrapper change in Task 4/5 (page background extends to top; sticky `top-0` pins under notch with iOS Safari's default behavior) — verified Task 6 |
| Mobile keyboard accommodates search input | Document scroll inherits this — verified Task 6 |
| Both dashboards retain existing data flow | No `page.tsx` or query changes |
