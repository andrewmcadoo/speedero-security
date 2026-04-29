# Pinned Shell and Today Anchor — Design

**Date:** 2026-04-29
**Branch:** feat/historical-card-snapshots (or successor)

## Problem

The dashboard scrolls as a single document: header (title, sign-out, bug report), the filter row (pills, date picker, search), and the date+card list all move together. Two consequences:

1. The user loses the navigation chrome the moment they start scrolling, so context (which dashboard, which filter is active) disappears off-screen.
2. There's no anchor for "now." On the management dashboard, the default range is `today−2..today+30` (per `src/app/dashboard/page.tsx`), but on load the page sits at the top — meaning users land on a 2-day-old snapshot card instead of today's live card.

## Goals

- Header and filter row stay pinned while only the card list scrolls.
- On load, the today card (or the next-upcoming card if today has none) is anchored at the top of the scrollable region.
- Scrolling up past the oldest card has a graceful elastic feel rather than a hard cliff.
- A "TODAY" banner appears when the today card has scrolled out of view, providing a one-tap return.

## Non-Goals

- Custom JS-simulated scroll bounce. We rely on native iOS Safari rubber-band behavior on the document scroll; desktop platforms get a hard stop, which is fine.
- Collapsible / shrinking header on scroll. The sticky stack height is fixed for math simplicity.
- Backend or data shape changes. This is purely a client-side restructuring of the dashboard components.
- Replacing the existing filter pill / date range mechanics. Both keep working as today.

## Design Overview

A **single document scroll** with the chrome made sticky, rather than a separate inner-scroll container. iOS Safari rubber-bands the document scroll natively; inner `overflow-y: auto` divs do not. Using sticky positioning means the elastic "bump" comes for free without writing custom physics.

```
┌─ DashboardShell (root, no inner scroll) ─────────────┐
│  <header>           position: sticky; top: 0         │
│  <DashboardFilters> position: sticky; top: HEADER_H  │
│  <TodayBanner>      position: sticky; top: STACK_H   │  ← conditional
│  <CardList>         normal flow (document scrolls)   │
└──────────────────────────────────────────────────────┘
```

This applies to **both** dashboards (`epo-dashboard.tsx` and `management-dashboard.tsx`). They share the same shell semantics and reuse the same banner + hooks.

## Components

### `<TodayBanner>` (new — `src/components/today-banner.tsx`)

```tsx
type Props = {
  todayISO: string;
  visible: boolean;
  onJumpToToday: () => void;
};
```

- Thin sticky bar styled like the active filter pill (`bg-blue-900/60 text-blue-400`).
- Content: `TODAY · MON APR 29` on the left, a small `↓ jump` chevron on the right.
- When `visible === false`, returns `null`. The sticky slot collapses so filters sit flush against cards. Transition is opacity-only on mount/unmount to avoid layout thrash.
- Click → calls `onJumpToToday`.

### `useTodayAnchor` (new — `src/lib/hooks/use-today-anchor.ts`)

```ts
function useTodayAnchor(
  todayISO: string,
  anchorRef: React.RefObject<HTMLElement | null>,
  deps: ReadonlyArray<unknown>,
): { jumpToToday: () => void };
```

- On mount and whenever `deps` change (filter, range, dataset length), if `anchorRef.current` is non-null, calls `element.scrollIntoView({ block: "start", behavior: "auto" })`. Auto-anchor is instant — the user should not see a scroll animation on initial load or filter swap; the page should *appear* anchored.
- Sticky-stack offset is handled via CSS `scroll-margin-top` on the anchor element rather than JS math, keeping the hook DOM-agnostic.
- Returns `jumpToToday`. Calling it scrolls with `behavior: "smooth"` (banner re-entry should feel intentional, not jarring). This is the *only* path that uses smooth scrolling.
- No-op when `anchorRef.current` is null (today not in current filter result, or filter excludes today).

### `useElementOffScreen` (new — same file)

```ts
function useElementOffScreen(ref: React.RefObject<HTMLElement | null>): boolean;
```

- Wraps `IntersectionObserver`. Root is the viewport (default). `rootMargin` has a negative top equal to the sticky stack height — so "off-screen" means "above the visible cards window," not "behind the sticky chrome."
- Returns `true` when the observed element is not intersecting; initial value `false`.
- Cleans up the observer on unmount and when the ref target changes.

### Dashboard wiring (changes to existing files)

**`src/app/dashboard/epo-dashboard.tsx`** and **`src/app/dashboard/management-dashboard.tsx`**:

- `<header>` gains `sticky top-0 z-30` (and a solid background to avoid bleed-through during scroll).
- The filter row container gains `sticky top-[HEADER_H] z-20` and a solid background.
- `<TodayBanner>` is rendered between filters and cards, with `sticky top-[STACK_H] z-10`.
- Inside the `filtered.map(...)` render:
  - Compute `anchorDate = filtered.find(e => e.date === todayISO)?.date ?? filtered.find(e => e.date >= todayISO)?.date`.
  - The card whose `entry.date === anchorDate` receives `ref={anchorRef}` plus `className="scroll-mt-[STACK_H]"`.
- The banner only listens to the `todayISO` card. If today has no card (anchor falls back to the next-upcoming card), the banner stays hidden — there is no "today" to jump to in that case.

**Stack height:** picked once as a single Tailwind value (e.g., `top-32` for header+filters, `top-40` when banner is visible). The `scroll-mt-*` value matches. No JS-side measurement needed.

## Behavior

### Initial load

1. Server renders entries (existing flow). Client mounts.
2. After first paint, `useTodayAnchor` runs:
   - If a card with `entry.date === todayISO` exists in the filtered set, that card scrolls into view.
   - Otherwise, the next-upcoming card (`entry.date >= todayISO`) gets the anchor and the banner stays hidden.
   - If neither exists (e.g., empty filter result), no scrolling happens.

### Scroll up to past edge (management dashboard)

- Default range `today−2..today+30` shows two snapshot cards above today.
- User scrolls up past the snapshots → document hits the top → on iOS Safari it rubber-bands and snaps back; on desktop it stops cleanly. No JS involved either way.
- Banner fades in once the today card has cleared the viewport (intersection callback fires).

### Scroll up on EPO dashboard

- Default `My Assignments` filter excludes past dates (existing behavior at `src/app/dashboard/epo-dashboard.tsx:49-52`). Today (or next-upcoming) is at the top — scrolling up bumps immediately.
- `Past Assignments` filter inverts the dataset; the anchor hook no-ops (today is not in the result), and the list naturally anchors at the top.

### Filter / date range change

- `useTodayAnchor` deps include `filtered.length` and the active filter value.
- On change, if today is in the new set → re-anchor. Otherwise no-op (list shows from the top, which is the natural reading position for a filter switch).
- This re-anchor is intentional: switching filters should land the user at "now" if "now" is in scope, rather than wherever they happened to be scrolled in the previous filter.

### Banner click

- Calls `jumpToToday`. Smooth scroll so the snap-back doesn't jar after a long scroll.

### Future-side bump

- Symmetric. Document hits its bottom → iOS rubber-bands, desktop hard-stops. Same elastic feel without extra code.

### Mobile safe areas / keyboard

- Sticky tops add `env(safe-area-inset-top, 0)` only where iOS notch padding would matter.
- Document scroll (vs. inner scroll) accommodates the on-screen keyboard for the search input automatically — no `100dvh` math, no edge cases when the keyboard opens.

## Implementation Notes

- **Z-index stack:** header `z-30` > filters `z-20` > banner `z-10` > cards default. Prevents bleed-through during scroll on devices where sticky elements briefly overlap.
- **Solid backgrounds on sticky elements:** required, since cards now scroll behind them. Use the existing dashboard background color.
- **`scroll-margin-top`** is used instead of JS-computed scroll offsets so the anchor logic doesn't need to know the stack height in pixels.
- **Server components stay server.** The two dashboard components are already `"use client"`; no boundary changes.

## Testing

### Hook tests — `src/lib/hooks/use-today-anchor.test.ts`

- `useTodayAnchor` calls `scrollIntoView` once on mount when ref is attached. Spy `Element.prototype.scrollIntoView`; assert called with `{ block: "start", behavior: "auto" }`.
- Re-anchors when `deps` change and the ref still points at a card.
- No-ops when `anchorRef.current` is null.
- `jumpToToday` calls `scrollIntoView` with `behavior: "smooth"` (distinct from the auto-anchor path).
- `useElementOffScreen` returns `false` when `IntersectionObserver` reports intersecting, `true` otherwise. Mock `IntersectionObserver` with a controllable callback.

### Component test — `src/components/today-banner.test.tsx`

- Returns `null` when `visible === false`.
- Renders date label and calls `onJumpToToday` on click when `visible === true`.

### Dashboard integration

- Existing dashboard tests stay green — no data shape change.
- One new test per dashboard: with a today-matching entry in the filtered set, the today card receives the anchor ref and `scroll-mt-*` class. With no matching entry, the next-upcoming card receives them; the banner stays hidden.

### Manual verification

- **iOS Safari:** load → today centered → scroll up past 2 snapshots → elastic bounce → banner appears → tap banner → smooth scroll back. Verify safe-area inset behavior on a notched device.
- **Desktop Chrome:** load → today in view → scroll up → hard stop (no native bounce expected on desktop) → banner appears → click → smooth scroll back.
- **Filter swap (EPO):** All → Past Assignments → All. No scroll-position weirdness; anchor re-applies on the swap back.
- **Date range change (management):** picker change → anchor re-applies if today is in the new range.

## Out of Scope

- Custom JS bounce simulation.
- Sticky-stack height drift (collapsible header).
- Per-card animations on filter change.
- Any change to the data fetching, server pipeline, or snapshot logic.
