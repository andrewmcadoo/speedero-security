# Historical Card Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users pick any date or date range — including the past — and view cards for those dates. Past cards are frozen point-in-time snapshots in Postgres and are read-only. Today and future cards keep reading live from Google Sheets and Google Calendar.

**Architecture:** A new `card_snapshots(date primary key, payload jsonb)` table stores frozen DashboardEntry rows. A nightly systemd timer on Clipper hits a new `POST /api/snapshot/run` endpoint that captures the prior 7 days' missing snapshots from live sources. The dashboard server component splits its read by date — snapshots for `< today`, live for `>= today` — and lazily backfills any past gap inline using the same live data already fetched for today. Mutations move from direct client-to-Supabase calls into Next.js server actions so an `assertNotPast(date)` guard runs before any write. A new `<DateRangeControl>` lives in the existing filter row with a popover month-grid calendar (Kayak/Airbnb click pattern) and writes its state to URL search params.

**Tech Stack:** Next.js 16 (App Router, RSC + server actions), TypeScript, `@supabase/ssr`, `googleapis`, Tailwind v4, Bun (`bun test` runner), systemd on Clipper.

**Spec:** `docs/superpowers/specs/2026-04-28-historical-card-snapshots-design.md`

---

## File Structure

**Create:**

- `supabase/migrations/011_card_snapshots.sql` — new table + RLS.
- `src/lib/access-control.ts` — `assertNotPast(date)` helper. Single source of truth for the past-date write guard.
- `src/app/dashboard/actions.ts` — `'use server'` module. Six exported server actions (one per current direct-Supabase mutation). Each calls `assertNotPast` before touching the database.
- `src/lib/snapshot/assemble.ts` — pure helper `assembleDashboardEntry(date, sources)` that builds a single `DashboardEntry` from raw live sources. Used by both the live read path (extracted from current `dashboard/page.tsx`) and the snapshot freezer.
- `src/lib/snapshot/freeze.ts` — `freezeDashboardEntry(entry): unknown` (payload serializer) and `runSnapshot({ today, source, supabase })` orchestration used by both the cron endpoint and lazy backfill.
- `src/lib/snapshot/freeze.test.ts` — unit tests for `freezeDashboardEntry` shape stability + `runSnapshot` selection logic.
- `src/lib/dashboard/range.ts` — `parseRangeFromSearchParams(params, { today, role })` + small date-range helpers (`clampRange`, etc.). Pure, fully tested.
- `src/lib/dashboard/range.test.ts` — unit tests.
- `src/app/api/snapshot/run/route.ts` — POST endpoint guarded by `SNAPSHOT_CRON_TOKEN`. Calls `runSnapshot`.
- `src/components/date-range-control.tsx` — the `[📅] Mar 12 → Mar 18` trigger + popover month grid. Client component.
- `src/components/date-range-control.test.tsx` — covered via small focused unit tests on the pure date-math + selection logic that lives alongside the component (factored into `date-range-control-utils.ts` if needed).
- `scripts/deploy/speedero-snapshot.service` — systemd unit that POSTs to the loopback endpoint with the bearer token.
- `scripts/deploy/speedero-snapshot.timer` — TZ-aware nightly schedule.

**Modify:**

- `src/types/schedule.ts` — add `CardSnapshot` type, add `isFromSnapshot?: boolean` and `isMissing?: boolean` to `DashboardEntry`, add a documented "snapshot payload" alias.
- `src/lib/schedule-utils.ts` — add date-math helpers (`addDays`, `datesBetween`, `minDate`, `maxDate`).
- `src/lib/schedule-utils.test.ts` — tests for the new helpers.
- `src/lib/supabase/queries.ts` — add `getSnapshotDates(supabase, dates)`, `getSnapshotsBetween(supabase, start, end)`, `upsertSnapshot(supabase, { date, payload, frozenBy })`.
- `src/components/epo-assignment.tsx` — drop direct `supabase.from()` calls, call `assignEpo` / `unassignEpo` server actions instead.
- `src/components/teak-toggle.tsx` — drop direct `supabase.from()` calls, call `createTravelLeg` / `updateTravelLeg` / `deleteTravelLeg` server actions instead.
- `src/components/detail-dropdown.tsx` — drop direct `supabase.from()` calls, call `setDetailLevel` server action instead.
- `src/components/management-card.tsx` — render `DetailDropdown` / `EpoAssignment` / `TeakToggle` only when `!entry.isPast`. When `entry.isMissing`, render the placeholder card.
- `src/app/dashboard/management-dashboard.tsx` — propagate `isPast` and `isMissing` props through to the card; do not filter them out.
- `src/app/dashboard/epo-dashboard.tsx` — handle `isMissing` filter behavior (default range no longer includes deep past).
- `src/app/dashboard/page.tsx` — split past (snapshots) from live (today+future); call `parseRangeFromSearchParams`; trigger lazy backfill; emit `isMissing` placeholders.
- `src/components/dashboard-filters.tsx` — render the new `<DateRangeControl>` between the pill filters and the search input.
- `scripts/deploy/SETUP.md` — install steps for the snapshot timer + token rotation guidance.
- `.env.local.example` — document `SNAPSHOT_CRON_TOKEN`.

---

## Phasing

The plan is grouped into six phases. **Each phase produces working, independently deployable software.** You can ship after Phase 1 (just the server-action refactor and read-only audit) and the rest is purely additive.

- **Phase 1 — Foundation (Tasks 1–3):** date helpers, access-control guard, migration. No behavior change.
- **Phase 2 — Server actions refactor (Tasks 4–8):** move all six mutations behind server actions with `assertNotPast`. Hide the editing affordances on the management card when `isPast`. Net effect: today's app behaves the same, but past dates (which currently can only appear in the EPO view) are now also write-guarded.
- **Phase 3 — Snapshot infrastructure (Tasks 9–12):** `assembleDashboardEntry` helper, snapshot queries, `runSnapshot` orchestration, `/api/snapshot/run` endpoint. No UI change yet.
- **Phase 4 — Read-path split + lazy backfill (Tasks 13–16):** `parseRangeFromSearchParams`, dashboard reads snapshots for past, lazy backfill, `isMissing` placeholder. URL params drive the range; default range matches the spec.
- **Phase 5 — Date picker UI (Tasks 17–20):** `<DateRangeControl>` trigger + popover, range selection, presets, integration into the filter row.
- **Phase 6 — Deployment (Tasks 21–22):** systemd timer + service files, SETUP.md.

---

## Phase 1 — Foundation

### Task 1: Add date-math helpers to `schedule-utils`

These are tiny pure functions. The snapshot read path, the lazy backfill, and `parseRangeFromSearchParams` all need them.

**Files:**
- Modify: `src/lib/schedule-utils.ts`
- Modify: `src/lib/schedule-utils.test.ts`

- [ ] **Step 1: Write failing tests for the four helpers**

Append to `src/lib/schedule-utils.test.ts`:

```ts
import { addDays, datesBetween, minDate, maxDate } from "./schedule-utils";

describe("addDays", () => {
  test("adds positive days", () => {
    expect(addDays("2026-04-28", 1)).toBe("2026-04-29");
    expect(addDays("2026-04-28", 7)).toBe("2026-05-05");
  });

  test("subtracts with negative input", () => {
    expect(addDays("2026-04-28", -1)).toBe("2026-04-27");
    expect(addDays("2026-04-01", -1)).toBe("2026-03-31");
  });

  test("crosses month boundary forward", () => {
    expect(addDays("2026-04-30", 1)).toBe("2026-05-01");
  });

  test("crosses year boundary backward", () => {
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  test("zero is identity", () => {
    expect(addDays("2026-04-28", 0)).toBe("2026-04-28");
  });
});

describe("datesBetween", () => {
  test("inclusive on both ends", () => {
    expect(datesBetween("2026-04-28", "2026-04-30")).toEqual([
      "2026-04-28",
      "2026-04-29",
      "2026-04-30",
    ]);
  });

  test("single-day range returns one element", () => {
    expect(datesBetween("2026-04-28", "2026-04-28")).toEqual(["2026-04-28"]);
  });

  test("returns empty when start > end", () => {
    expect(datesBetween("2026-04-30", "2026-04-28")).toEqual([]);
  });
});

describe("minDate / maxDate", () => {
  test("minDate returns the earlier ISO string", () => {
    expect(minDate("2026-04-28", "2026-04-30")).toBe("2026-04-28");
    expect(minDate("2026-04-30", "2026-04-28")).toBe("2026-04-28");
    expect(minDate("2026-04-28", "2026-04-28")).toBe("2026-04-28");
  });

  test("maxDate returns the later ISO string", () => {
    expect(maxDate("2026-04-28", "2026-04-30")).toBe("2026-04-30");
    expect(maxDate("2026-04-30", "2026-04-28")).toBe("2026-04-30");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/lib/schedule-utils.test.ts`
Expected: FAIL — "addDays is not a function" (or similar import error).

- [ ] **Step 3: Implement the helpers**

Append to `src/lib/schedule-utils.ts`:

```ts
/**
 * Add `n` days to an ISO date string (YYYY-MM-DD), returning a new ISO date
 * string. Pure calendar arithmetic via UTC — no timezone effects.
 */
export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Inclusive list of every ISO date from `start` to `end`. Returns [] when
 * `start > end`.
 */
export function datesBetween(start: string, end: string): string[] {
  if (start > end) return [];
  const out: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

/** Lexicographic min works on YYYY-MM-DD strings. */
export function minDate(a: string, b: string): string {
  return a <= b ? a : b;
}

/** Lexicographic max works on YYYY-MM-DD strings. */
export function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/lib/schedule-utils.test.ts`
Expected: PASS — all `addDays` / `datesBetween` / `minDate` / `maxDate` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/schedule-utils.ts src/lib/schedule-utils.test.ts
git commit -m "feat(schedule-utils): add addDays/datesBetween/minDate/maxDate helpers"
```

---

### Task 2: Add `assertNotPast` access-control helper

This is the single source of truth for the past-date write guard. Every server action calls it.

**Files:**
- Create: `src/lib/access-control.ts`
- Create: `src/lib/access-control.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/access-control.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { assertNotPast, PastDateWriteError } from "./access-control";

describe("assertNotPast", () => {
  const originalTz = process.env.APP_TIMEZONE;

  afterEach(() => {
    if (originalTz === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = originalTz;
  });

  test("throws PastDateWriteError when date is strictly before today", () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z"); // 08:00 PT
    expect(() => assertNotPast("2026-04-27", now)).toThrow(PastDateWriteError);
  });

  test("does not throw for today's date", () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z"); // 08:00 PT, today=2026-04-28
    expect(() => assertNotPast("2026-04-28", now)).not.toThrow();
  });

  test("does not throw for a future date", () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    expect(() => assertNotPast("2026-05-01", now)).not.toThrow();
  });

  test("respects APP_TIMEZONE for the today boundary", () => {
    // 2026-04-29T04:00 UTC = 2026-04-28 21:00 PT, but 2026-04-29 13:00 Tokyo.
    // In LA, today=2026-04-28 → assertNotPast('2026-04-28') passes.
    // In Tokyo, today=2026-04-29 → assertNotPast('2026-04-28') throws.
    const now = new Date("2026-04-29T04:00:00Z");

    process.env.APP_TIMEZONE = "America/Los_Angeles";
    expect(() => assertNotPast("2026-04-28", now)).not.toThrow();

    process.env.APP_TIMEZONE = "Asia/Tokyo";
    expect(() => assertNotPast("2026-04-28", now)).toThrow(PastDateWriteError);
  });

  test("error message names the date for debugging", () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    try {
      assertNotPast("2026-04-27", now);
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PastDateWriteError);
      expect((err as Error).message).toContain("2026-04-27");
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/lib/access-control.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `src/lib/access-control.ts`:

```ts
import { getAnchorDates } from "./schedule-utils";

export class PastDateWriteError extends Error {
  constructor(public readonly date: string, public readonly today: string) {
    super(`Refusing to mutate past date ${date} (today is ${today})`);
    this.name = "PastDateWriteError";
  }
}

/**
 * Throws PastDateWriteError when `dateStr` is strictly before today in
 * APP_TIMEZONE. "Today" is the same string returned by `getAnchorDates`,
 * so this is the single source of truth for the past/present boundary.
 *
 * `now` is exposed for testing only.
 */
export function assertNotPast(dateStr: string, now: Date = new Date()): void {
  const { today } = getAnchorDates(now);
  if (dateStr < today) {
    throw new PastDateWriteError(dateStr, today);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/lib/access-control.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/access-control.ts src/lib/access-control.test.ts
git commit -m "feat(access-control): add assertNotPast guard for past-date writes"
```

---

### Task 3: Migration `011_card_snapshots.sql` and `CardSnapshot` type

Adds the table and types. Doesn't read or write yet — that's Phase 3.

**Files:**
- Create: `supabase/migrations/011_card_snapshots.sql`
- Modify: `src/types/schedule.ts`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/011_card_snapshots.sql`:

```sql
-- Frozen point-in-time snapshots of past dashboard cards.
-- Cron writes here (frozen_by='cron'); lazy backfill in the dashboard
-- writes here too (frozen_by='lazy'). 'manual' is reserved for a future
-- admin re-snapshot action and is allowed by the check constraint so we
-- don't need a migration when we add it.
create table card_snapshots (
  date date primary key,
  payload jsonb not null,
  frozen_at timestamptz not null default now(),
  frozen_by text not null check (frozen_by in ('cron', 'lazy', 'manual'))
);

create index idx_card_snapshots_date on card_snapshots(date);

alter table card_snapshots enable row level security;

create policy "Authenticated can read snapshots"
  on card_snapshots for select
  using (auth.uid() is not null);

create policy "Management can insert snapshots"
  on card_snapshots for insert
  with check (is_management());

create policy "Management can update snapshots"
  on card_snapshots for update
  using (is_management());
```

- [ ] **Step 2: Add `CardSnapshot` type**

Modify `src/types/schedule.ts`. Append after the existing `Transition` interface (currently the last block in the file):

```ts
export interface CardSnapshot {
  date: string;
  payload: DashboardEntry;
  frozenAt: string;
  frozenBy: "cron" | "lazy" | "manual";
}
```

Also extend the existing `DashboardEntry` interface (around line 54) to add two new optional flags. Replace the existing `DashboardEntry` block with:

```ts
export interface DashboardEntry extends ScheduleEntry {
  detailLevel: DetailLevel;
  assignedEpos: Pick<Profile, "id" | "fullName" | "email">[];
  isPast?: boolean;
  isThisWeek?: boolean;
  isNextWeek?: boolean;
  pickupLeg?: TravelLeg;
  dropoffLeg?: TravelLeg;
  transitions: Transition[];
  isFromSnapshot?: boolean;
  isMissing?: boolean;
}
```

- [ ] **Step 3: Confirm typecheck passes**

Run: `bun x tsc --noEmit`
Expected: clean exit. The new optional fields don't break existing literals.

- [ ] **Step 4: Apply the migration to the local Supabase**

This step must be performed by AJ in the Supabase SQL Editor (or via the local Supabase CLI, depending on the setup). The agent should print the migration content with this instruction:

> Apply `supabase/migrations/011_card_snapshots.sql` against the development Supabase project before continuing. Verify with: `select count(*) from card_snapshots;` (should return `0`).

If the agent has access to a local Supabase CLI, it may run `supabase db push` (or the equivalent) and verify; otherwise pause for AJ.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/011_card_snapshots.sql src/types/schedule.ts
git commit -m "feat(snapshots): add card_snapshots table and CardSnapshot type"
```

---

## Phase 2 — Server actions refactor

This phase is independently shippable. After it lands, every mutation goes through a server action with `assertNotPast`, and the management card hides editing controls for past dates. The snapshot system isn't built yet, but the boundary is in place.

### Task 4: Server-action skeleton + `assignEpo`

**Files:**
- Create: `src/app/dashboard/actions.ts`
- Create: `src/app/dashboard/actions.test.ts`

- [ ] **Step 1: Write the failing test for `assignEpo`'s past-date guard**

Create `src/app/dashboard/actions.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { _assignEpoForTest } from "./actions";

// _assignEpoForTest is the testable inner function: it takes the (date, epoId,
// supabaseFactory, now) and returns the action's outcome. The exported `assignEpo`
// wraps it with the real createClient + new Date().

describe("assignEpo guard", () => {
  const originalTz = process.env.APP_TIMEZONE;

  afterEach(() => {
    if (originalTz === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = originalTz;
  });

  test("returns ok=false for a past date and never touches supabase", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    let called = false;
    const result = await _assignEpoForTest(
      "2026-04-27",
      "epo-uuid",
      () => {
        called = true;
        throw new Error("supabase factory must not be called for past dates");
      },
      now
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("2026-04-27");
    expect(called).toBe(false);
  });

  test("calls supabase for a today/future date", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    let inserted: Record<string, unknown> | null = null;
    const result = await _assignEpoForTest(
      "2026-04-28",
      "epo-uuid",
      () => ({
        auth: { getUser: async () => ({ data: { user: { id: "mgr-uuid" } } }) },
        from: () => ({
          insert: async (row: Record<string, unknown>) => {
            inserted = row;
            return { error: null };
          },
        }),
      }),
      now
    );
    expect(result.ok).toBe(true);
    expect(inserted).toEqual({
      date: "2026-04-28",
      epo_id: "epo-uuid",
      assigned_by: "mgr-uuid",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/app/dashboard/actions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the action skeleton + `assignEpo`**

Create `src/app/dashboard/actions.ts`:

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { assertNotPast, PastDateWriteError } from "@/lib/access-control";
import { revalidatePath } from "next/cache";

export type ActionResult = { ok: true } | { ok: false; error: string };

// The supabase client returned by createClient() is intentionally typed as
// `unknown` here — the test factory returns a hand-rolled stub with just the
// methods we use. The real createClient() returns a SupabaseClient with the
// full surface; we narrow at the call sites.
type SupabaseLike = {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
    delete?: () => unknown;
    update?: (row: Record<string, unknown>) => unknown;
    upsert?: (row: Record<string, unknown>, opts?: unknown) => Promise<{ error: { message: string } | null }>;
  };
};

type SupabaseFactory = () => SupabaseLike | Promise<SupabaseLike>;

async function withGuard(
  dateStr: string,
  now: Date,
  fn: (supabase: SupabaseLike, userId: string) => Promise<ActionResult>,
  factory: SupabaseFactory
): Promise<ActionResult> {
  try {
    assertNotPast(dateStr, now);
  } catch (err) {
    if (err instanceof PastDateWriteError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }
  const supabase = await factory();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };
  return fn(supabase, user.id);
}

// ---- assignEpo ----

export async function _assignEpoForTest(
  date: string,
  epoId: string,
  factory: SupabaseFactory,
  now: Date
): Promise<ActionResult> {
  return withGuard(date, now, async (supabase, userId) => {
    const { error } = await supabase.from("assignments").insert({
      date,
      epo_id: epoId,
      assigned_by: userId,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }, factory);
}

export async function assignEpo(
  date: string,
  epoId: string
): Promise<ActionResult> {
  const result = await _assignEpoForTest(
    date,
    epoId,
    () => createClient() as unknown as SupabaseLike,
    new Date()
  );
  if (result.ok) revalidatePath("/dashboard");
  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/app/dashboard/actions.test.ts`
Expected: PASS — both `assignEpo guard` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/actions.ts src/app/dashboard/actions.test.ts
git commit -m "feat(actions): add server-action scaffolding + assignEpo with past-date guard"
```

---

### Task 5: Refactor `epo-assignment.tsx` to call `assignEpo`

**Files:**
- Modify: `src/components/epo-assignment.tsx`

- [ ] **Step 1: Replace direct Supabase call in `handleAssign`**

In `src/components/epo-assignment.tsx`, change the imports — drop `createClient`, add `assignEpo`:

```tsx
import { assignEpo } from "@/app/dashboard/actions";
```

(remove `import { createClient } from "@/lib/supabase/client";`)

Then replace the body of `handleAssign` (currently lines 40–58) with:

```tsx
  const handleAssign = async (epo: EpoInfo) => {
    // Optimistic update
    const prev = assigned;
    setAssigned([...assigned, epo]);
    setShowDropdown(false);

    const result = await assignEpo(date, epo.id);
    if (!result.ok) {
      console.error("Assignment failed:", result.error);
      setAssigned(prev); // Revert
    } else {
      router.refresh();
    }
  };
```

- [ ] **Step 2: Verify the assign flow manually**

Run: `bun dev` (in another terminal, or background)
Open the dashboard as a management user, expand a today/future card, assign an EPO. Expected: tag appears in the assigned list, page revalidates, no console error.

- [ ] **Step 3: Commit**

```bash
git add src/components/epo-assignment.tsx
git commit -m "refactor(epo-assignment): call assignEpo server action instead of direct supabase"
```

---

### Task 6: Add `unassignEpo` server action and refactor delete path

**Files:**
- Modify: `src/app/dashboard/actions.ts`
- Modify: `src/app/dashboard/actions.test.ts`
- Modify: `src/components/epo-assignment.tsx`

- [ ] **Step 1: Write the failing test for `unassignEpo`**

Append to `src/app/dashboard/actions.test.ts`:

```ts
import { _unassignEpoForTest } from "./actions";

describe("unassignEpo guard", () => {
  const originalTz = process.env.APP_TIMEZONE;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = originalTz;
  });

  test("returns ok=false for past dates without touching supabase", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    let called = false;
    const result = await _unassignEpoForTest(
      "2026-04-27",
      "epo-uuid",
      () => {
        called = true;
        throw new Error("must not be called");
      },
      now
    );
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  test("issues a delete().eq('date').eq('epo_id') for valid dates", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    const calls: { date?: string; epoId?: string } = {};
    const result = await _unassignEpoForTest(
      "2026-04-28",
      "epo-uuid",
      () => ({
        auth: { getUser: async () => ({ data: { user: { id: "mgr-uuid" } } }) },
        from: () => ({
          insert: async () => ({ error: null }),
          delete: () => ({
            eq: (col: string, val: string) => {
              if (col === "date") calls.date = val;
              if (col === "epo_id") calls.epoId = val;
              return {
                eq: (col2: string, val2: string) => {
                  if (col2 === "date") calls.date = val2;
                  if (col2 === "epo_id") calls.epoId = val2;
                  return Promise.resolve({ error: null });
                },
              };
            },
          }),
        }),
      }),
      now
    );
    expect(result.ok).toBe(true);
    expect(calls).toEqual({ date: "2026-04-28", epoId: "epo-uuid" });
  });
});
```

- [ ] **Step 2: Run the new tests — they should fail**

Run: `bun test src/app/dashboard/actions.test.ts`
Expected: FAIL — `_unassignEpoForTest` not exported.

- [ ] **Step 3: Implement `unassignEpo`**

Append to `src/app/dashboard/actions.ts`:

```ts
// ---- unassignEpo ----

export async function _unassignEpoForTest(
  date: string,
  epoId: string,
  factory: SupabaseFactory,
  now: Date
): Promise<ActionResult> {
  return withGuard(date, now, async (supabase) => {
    // The supabase delete chain returns a builder; the type stub is loose
    // because we only verify shape in tests.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = supabase.from("assignments").delete!();
    const { error } = await builder.eq("date", date).eq("epo_id", epoId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }, factory);
}

export async function unassignEpo(
  date: string,
  epoId: string
): Promise<ActionResult> {
  const result = await _unassignEpoForTest(
    date,
    epoId,
    () => createClient() as unknown as SupabaseLike,
    new Date()
  );
  if (result.ok) revalidatePath("/dashboard");
  return result;
}
```

- [ ] **Step 4: Refactor the `handleRemove` in `epo-assignment.tsx`**

Add to imports:

```tsx
import { assignEpo, unassignEpo } from "@/app/dashboard/actions";
```

Replace `handleRemove` body (currently lines 60–77) with:

```tsx
  const handleRemove = async (epoId: string) => {
    const prev = assigned;
    setAssigned(assigned.filter((a) => a.id !== epoId));

    const result = await unassignEpo(date, epoId);
    if (!result.ok) {
      console.error("Remove assignment failed:", result.error);
      setAssigned(prev);
    } else {
      router.refresh();
    }
  };
```

- [ ] **Step 5: Run all tests and the build to verify**

Run: `bun test && bun x tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/actions.ts src/app/dashboard/actions.test.ts src/components/epo-assignment.tsx
git commit -m "feat(actions): add unassignEpo and refactor epo-assignment delete path"
```

---

### Task 7: Add `setDetailLevel` server action and refactor `detail-dropdown.tsx`

**Files:**
- Modify: `src/app/dashboard/actions.ts`
- Modify: `src/app/dashboard/actions.test.ts`
- Modify: `src/components/detail-dropdown.tsx`

- [ ] **Step 1: Write the failing test for `setDetailLevel`**

Append to `src/app/dashboard/actions.test.ts`:

```ts
import { _setDetailLevelForTest } from "./actions";

describe("setDetailLevel guard", () => {
  const originalTz = process.env.APP_TIMEZONE;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = originalTz;
  });

  test("rejects past dates without touching supabase", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    let called = false;
    const result = await _setDetailLevelForTest(
      "2026-04-27",
      "single",
      () => {
        called = true;
        throw new Error("must not be called");
      },
      now
    );
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  test("upserts on date conflict for valid dates", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    let upsertedRow: Record<string, unknown> | null = null;
    let conflictKey: string | undefined;
    const result = await _setDetailLevelForTest(
      "2026-04-28",
      "dual",
      () => ({
        auth: { getUser: async () => ({ data: { user: { id: "mgr-uuid" } } }) },
        from: () => ({
          insert: async () => ({ error: null }),
          upsert: async (row: Record<string, unknown>, opts: { onConflict?: string }) => {
            upsertedRow = row;
            conflictKey = opts?.onConflict;
            return { error: null };
          },
        }),
      }),
      now
    );
    expect(result.ok).toBe(true);
    expect(conflictKey).toBe("date");
    expect(upsertedRow).toMatchObject({
      date: "2026-04-28",
      detail_level: "dual",
      updated_by: "mgr-uuid",
    });
  });
});
```

- [ ] **Step 2: Run tests — they should fail**

Run: `bun test src/app/dashboard/actions.test.ts`
Expected: FAIL — `_setDetailLevelForTest` not exported.

- [ ] **Step 3: Implement `setDetailLevel`**

Append to `src/app/dashboard/actions.ts`:

```ts
import type { DetailLevel } from "@/types/schedule";

// ---- setDetailLevel ----

export async function _setDetailLevelForTest(
  date: string,
  level: DetailLevel,
  factory: SupabaseFactory,
  now: Date
): Promise<ActionResult> {
  return withGuard(date, now, async (supabase, userId) => {
    const { error } = await supabase.from("date_settings").upsert!({
      date,
      detail_level: level,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "date" });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }, factory);
}

export async function setDetailLevel(
  date: string,
  level: DetailLevel
): Promise<ActionResult> {
  const result = await _setDetailLevelForTest(
    date,
    level,
    () => createClient() as unknown as SupabaseLike,
    new Date()
  );
  if (result.ok) revalidatePath("/dashboard");
  return result;
}
```

- [ ] **Step 4: Refactor `detail-dropdown.tsx`**

Replace the imports + `update` function in `src/components/detail-dropdown.tsx`. Remove `import { createClient } ...`, add:

```tsx
import { setDetailLevel } from "@/app/dashboard/actions";
```

Replace the `update` function body (currently lines 28–47):

```tsx
  const update = async (newValue: DetailLevel) => {
    setValue(newValue);
    const result = await setDetailLevel(date, newValue);
    if (!result.ok) {
      console.error("Detail level save failed:", result.error);
      setValue(value);
    } else {
      router.refresh();
    }
  };
```

The component still receives `profileId` as a prop today, but the server action resolves the user from the session. **Drop the `profileId` prop** from the component signature and from every call site.

Find call sites:

```bash
grep -rn "DetailDropdown" /Users/aj/Desktop/Projects/Workspace/speedero-security/src/
```

Update the call site (likely `src/components/management-card.tsx`) to drop the `profileId={profileId}` prop.

- [ ] **Step 5: Run all tests and typecheck**

Run: `bun test && bun x tsc --noEmit`
Expected: all green.

- [ ] **Step 6: Smoke-test in browser**

Run: `bun dev`. Change a detail level on a today/future card. Verify it persists across `router.refresh()` and no console error.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/actions.ts src/app/dashboard/actions.test.ts src/components/detail-dropdown.tsx src/components/management-card.tsx
git commit -m "feat(actions): add setDetailLevel and refactor detail-dropdown"
```

---

### Task 8: Add three travel-leg server actions and refactor `teak-toggle.tsx`

The Teak toggle has three mutation paths (create, update, delete). Add all three actions in one task since they share a table; refactor the component once.

**Files:**
- Modify: `src/app/dashboard/actions.ts`
- Modify: `src/app/dashboard/actions.test.ts`
- Modify: `src/components/teak-toggle.tsx`

- [ ] **Step 1: Write tests for the three actions**

Append to `src/app/dashboard/actions.test.ts`:

```ts
import {
  _createTravelLegForTest,
  _updateTravelLegForTest,
  _deleteTravelLegForTest,
} from "./actions";

describe("travel-leg guards", () => {
  const originalTz = process.env.APP_TIMEZONE;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = originalTz;
  });

  test("createTravelLeg rejects past dates", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    const result = await _createTravelLegForTest(
      "2026-04-27",
      "Pick up",
      () => { throw new Error("must not be called"); },
      now
    );
    expect(result.ok).toBe(false);
  });

  test("updateTravelLeg rejects past dates", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    const result = await _updateTravelLegForTest(
      "2026-04-27",
      "Pick up",
      { location: "X" },
      () => { throw new Error("must not be called"); },
      now
    );
    expect(result.ok).toBe(false);
  });

  test("deleteTravelLeg rejects past dates", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    const result = await _deleteTravelLegForTest(
      "2026-04-27",
      "Pick up",
      () => { throw new Error("must not be called"); },
      now
    );
    expect(result.ok).toBe(false);
  });

  test("createTravelLeg inserts a row with date+action+created_by for valid date", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    let inserted: Record<string, unknown> | null = null;
    const result = await _createTravelLegForTest(
      "2026-04-28",
      "Pick up",
      () => ({
        auth: { getUser: async () => ({ data: { user: { id: "mgr-uuid" } } }) },
        from: () => ({
          insert: async (row: Record<string, unknown>) => {
            inserted = row;
            return { error: null };
          },
        }),
      }),
      now
    );
    expect(result.ok).toBe(true);
    expect(inserted).toEqual({
      date: "2026-04-28",
      action: "Pick up",
      created_by: "mgr-uuid",
    });
  });
});
```

- [ ] **Step 2: Run — should fail with missing exports**

Run: `bun test src/app/dashboard/actions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the three actions**

Append to `src/app/dashboard/actions.ts`:

```ts
// ---- travel-leg actions ----

type TravelAction = "Pick up" | "Drop off";

const TRAVEL_LEG_COLUMNS: Record<string, string> = {
  location: "location",
  time: "time",
  companion: "companion",
  companionPrePositionFlight: "companion_pre_position_flight",
  teakFlight: "teak_flight",
  companionReturnFlight: "companion_return_flight",
};

export async function _createTravelLegForTest(
  date: string,
  action: TravelAction,
  factory: SupabaseFactory,
  now: Date
): Promise<ActionResult> {
  return withGuard(date, now, async (supabase, userId) => {
    const { error } = await supabase.from("travel_legs").insert({
      date,
      action,
      created_by: userId,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }, factory);
}

export async function createTravelLeg(
  date: string,
  action: TravelAction
): Promise<ActionResult> {
  const result = await _createTravelLegForTest(
    date,
    action,
    () => createClient() as unknown as SupabaseLike,
    new Date()
  );
  if (result.ok) revalidatePath("/dashboard");
  return result;
}

export type TravelLegFields = Partial<{
  location: string;
  time: string;
  companion: string;
  companionPrePositionFlight: string;
  teakFlight: string;
  companionReturnFlight: string;
}>;

export async function _updateTravelLegForTest(
  date: string,
  action: TravelAction,
  fields: TravelLegFields,
  factory: SupabaseFactory,
  now: Date
): Promise<ActionResult> {
  return withGuard(date, now, async (supabase) => {
    const payload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    for (const [key, val] of Object.entries(fields)) {
      const col = TRAVEL_LEG_COLUMNS[key];
      if (col !== undefined && val !== undefined) payload[col] = val;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = supabase.from("travel_legs").update!(payload);
    const { error } = await builder.eq("date", date).eq("action", action);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }, factory);
}

export async function updateTravelLeg(
  date: string,
  action: TravelAction,
  fields: TravelLegFields
): Promise<ActionResult> {
  const result = await _updateTravelLegForTest(
    date,
    action,
    fields,
    () => createClient() as unknown as SupabaseLike,
    new Date()
  );
  if (result.ok) revalidatePath("/dashboard");
  return result;
}

export async function _deleteTravelLegForTest(
  date: string,
  action: TravelAction,
  factory: SupabaseFactory,
  now: Date
): Promise<ActionResult> {
  return withGuard(date, now, async (supabase) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = supabase.from("travel_legs").delete!();
    const { error } = await builder.eq("date", date).eq("action", action);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }, factory);
}

export async function deleteTravelLeg(
  date: string,
  action: TravelAction
): Promise<ActionResult> {
  const result = await _deleteTravelLegForTest(
    date,
    action,
    () => createClient() as unknown as SupabaseLike,
    new Date()
  );
  if (result.ok) revalidatePath("/dashboard");
  return result;
}
```

- [ ] **Step 4: Refactor `teak-toggle.tsx`**

In `src/components/teak-toggle.tsx`, replace the imports — remove `createClient`, add the three actions:

```tsx
import { createTravelLeg, updateTravelLeg, deleteTravelLeg, type TravelLegFields } from "@/app/dashboard/actions";
```

Replace `handleCreate` body (lines 95–117):

```tsx
  const handleCreate = async (action: Action) => {
    if (saving) return;
    setSaving(true);
    const { setLeg, setFields, setFormOpen } = slotFor(action);
    const newLeg = emptyLeg(date, action);
    setLeg(newLeg);
    setFields(toFieldState(newLeg));
    setFormOpen(true);
    const result = await createTravelLeg(date, action);
    if (!result.ok) {
      console.error("Insert travel leg failed:", result.error);
      setLeg(undefined);
      setFormOpen(false);
    } else {
      router.refresh();
    }
    setSaving(false);
  };
```

Replace `handleDelete` body (lines 119–139):

```tsx
  const handleDelete = async (action: Action) => {
    if (saving) return;
    setSaving(true);
    const { leg, setLeg, setFormOpen } = slotFor(action);
    const prev = leg;
    setLeg(undefined);
    setFormOpen(false);
    const result = await deleteTravelLeg(date, action);
    if (!result.ok) {
      console.error("Delete travel leg failed:", result.error);
      setLeg(prev);
    }
    setSaving(false);
  };
```

Replace `handleSave` body (lines 141–170) — note the `fields` shape uses the field keys directly, which matches `TravelLegFields`:

```tsx
  const handleSave = async (action: Action) => {
    if (saving) return;
    const { leg, setLeg, setFormOpen } = slotFor(action);
    if (!leg) return;
    setSaving(true);
    const fields = action === "Pick up" ? pickupFields : dropoffFields;

    const prev = leg;
    setLeg({ ...leg, ...fields });

    const result = await updateTravelLeg(date, action, fields as TravelLegFields);
    if (!result.ok) {
      console.error("Save travel leg failed:", result.error);
      setLeg(prev);
    } else {
      router.refresh();
      setFormOpen(false);
    }
    setSaving(false);
  };
```

Drop the unused `profileId` prop from `TeakToggleProps` and the `slotFor` callers. Update `src/components/management-card.tsx` to stop passing `profileId={profileId}` to `<TeakToggle>` (the prop signature has changed).

- [ ] **Step 5: Run all tests + typecheck + smoke**

Run: `bun test && bun x tsc --noEmit`
Expected: all green.

Then `bun dev`: open a today/future card, exercise create/edit/delete on Pick Up and Drop Off; verify state syncs after `router.refresh()`.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/actions.ts src/app/dashboard/actions.test.ts src/components/teak-toggle.tsx src/components/management-card.tsx
git commit -m "feat(actions): add travel-leg actions and refactor teak-toggle"
```

---

### Task 9: Hide editing affordances on past cards in management view

Today, `dashboard/page.tsx` filters `s.date >= today` for management, so management never sees a past card. After Phase 4 they will, so we have to handle the past read-only case in the management card now (otherwise a past date renders editing controls that fail loudly when the user clicks them).

**Files:**
- Modify: `src/app/dashboard/page.tsx`
- Modify: `src/components/management-card.tsx`

- [ ] **Step 1: Set `isPast` on management entries**

In `src/app/dashboard/page.tsx`, the management branch currently filters past dates out before mapping (line ~155: `.filter((s) => s.date >= today)`). Replace that with a no-op filter and set `isPast`:

Find:

```ts
    const entries: DashboardEntry[] = schedule
      .filter((s) => s.date >= today)
      .map((s) => {
        const setting = settingsMap.get(s.date);
        const legs = travelLegsByDate.get(s.date);
        return {
          ...s,
          detailLevel: setting?.detailLevel ?? "single",
          assignedEpos: assignmentsByDate.get(s.date) ?? [],
          isThisWeek: isThisWeek(s.date),
          isNextWeek: isNextWeek(s.date),
          pickupLeg: legs?.pickup,
          dropoffLeg: legs?.dropoff,
          transitions: transitionsByDate.get(s.date) ?? [],
        };
      });
```

Replace with:

```ts
    const entries: DashboardEntry[] = schedule
      .filter((s) => s.date >= today)
      .map((s) => {
        const setting = settingsMap.get(s.date);
        const legs = travelLegsByDate.get(s.date);
        return {
          ...s,
          detailLevel: setting?.detailLevel ?? "single",
          assignedEpos: assignmentsByDate.get(s.date) ?? [],
          isPast: s.date < today,
          isThisWeek: isThisWeek(s.date),
          isNextWeek: isNextWeek(s.date),
          pickupLeg: legs?.pickup,
          dropoffLeg: legs?.dropoff,
          transitions: transitionsByDate.get(s.date) ?? [],
        };
      });
```

We're keeping the filter for now (Phase 4 widens it). The `isPast` field is `false` for everything in this list today, but the card now reliably reads it.

- [ ] **Step 2: Hide editing components when `isPast` in `management-card.tsx`**

In `src/components/management-card.tsx`, find the JSX block that renders `<DetailDropdown>`, `<EpoAssignment>`, `<TeakToggle>`. They currently render unconditionally. Wrap each in a check.

Find every usage like (the exact JSX may differ — search for the component names):

```tsx
              <DetailDropdown ... />
```

Replace with:

```tsx
              {!entry.isPast && <DetailDropdown ... />}
```

Do the same for `<EpoAssignment ... />` and `<TeakToggle ... />`.

For the read-only display fallback when `isPast`, the card already renders the assigned-EPO tags in the collapsed header (see lines 80+ of management-card.tsx) — those continue to render. The user can see who was assigned but can't change it. Travel-leg details should still render in read-only form when present:

If the current code has:

```tsx
              <TeakToggle
                date={entry.date}
                initialPickup={entry.pickupLeg}
                initialDropoff={entry.dropoffLeg}
              />
```

Replace with:

```tsx
              {entry.isPast ? (
                <ReadOnlyTeakSummary entry={entry} />
              ) : (
                <TeakToggle
                  date={entry.date}
                  initialPickup={entry.pickupLeg}
                  initialDropoff={entry.dropoffLeg}
                />
              )}
```

Add the `ReadOnlyTeakSummary` helper at the bottom of `management-card.tsx`:

```tsx
function ReadOnlyTeakSummary({ entry }: { entry: DashboardEntry }) {
  if (!entry.pickupLeg && !entry.dropoffLeg) return null;
  return (
    <div className="border-t border-gray-700 pt-2.5">
      <div className="mb-1.5 text-[10px] text-gray-500">TEAK</div>
      <div className="space-y-2 text-xs text-gray-300">
        {entry.pickupLeg && (
          <div>
            <div className="text-[10px] uppercase text-green-400">Pick Up</div>
            <div>{entry.pickupLeg.location || "—"}</div>
            <div className="text-gray-400">{entry.pickupLeg.time}</div>
          </div>
        )}
        {entry.dropoffLeg && (
          <div>
            <div className="text-[10px] uppercase text-rose-400">Drop Off</div>
            <div>{entry.dropoffLeg.location || "—"}</div>
            <div className="text-gray-400">{entry.dropoffLeg.time}</div>
          </div>
        )}
      </div>
    </div>
  );
}
```

(The shape and styling intentionally mirror the existing collapsed view of a leg in `TravelDetailsSection`. Keep it minimal — visual polish is a separate concern.)

- [ ] **Step 3: Typecheck + smoke**

Run: `bun x tsc --noEmit`
Expected: clean.

`bun dev`: editing controls remain on today/future cards. (You can't yet visually confirm past behavior in management view because the filter still excludes past dates — Phase 4 changes that. The hide logic is in place for when it does.)

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/page.tsx src/components/management-card.tsx
git commit -m "feat(management-card): hide editing controls when entry.isPast"
```

---

## Phase 3 — Snapshot infrastructure

### Task 10: Snapshot read/write queries in `supabase/queries.ts`

**Files:**
- Modify: `src/lib/supabase/queries.ts`

- [ ] **Step 1: Add the three query functions**

Append to `src/lib/supabase/queries.ts`:

```ts
import type { CardSnapshot, DashboardEntry } from "@/types/schedule";

interface CardSnapshotRow {
  date: string;
  payload: DashboardEntry;
  frozen_at: string;
  frozen_by: "cron" | "lazy" | "manual";
}

function toCardSnapshot(row: CardSnapshotRow): CardSnapshot {
  return {
    date: row.date,
    payload: row.payload,
    frozenAt: row.frozen_at,
    frozenBy: row.frozen_by,
  };
}

/**
 * Returns the set of dates (within the input list) that already have a
 * snapshot row. Used by both the cron and the lazy backfill to skip
 * already-frozen dates.
 */
export async function getSnapshotDates(
  supabase: SupabaseClient,
  dates: string[]
): Promise<Set<string>> {
  if (dates.length === 0) return new Set();
  const { data, error } = await supabase
    .from("card_snapshots")
    .select("date")
    .in("date", dates);
  if (error) {
    console.error("getSnapshotDates failed:", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r: { date: string }) => r.date));
}

/**
 * Returns all snapshots whose date is in [start, end] inclusive, ordered
 * by date ascending.
 */
export async function getSnapshotsBetween(
  supabase: SupabaseClient,
  start: string,
  end: string
): Promise<CardSnapshot[]> {
  const { data, error } = await supabase
    .from("card_snapshots")
    .select("date, payload, frozen_at, frozen_by")
    .gte("date", start)
    .lte("date", end)
    .order("date", { ascending: true });
  if (error) {
    console.error("getSnapshotsBetween failed:", error.message);
    return [];
  }
  return (data ?? []).map((row) => toCardSnapshot(row as CardSnapshotRow));
}

/**
 * Insert a snapshot. Never overwrites — if a snapshot for `date` already
 * exists, this is a no-op (returns false). Returns true on insert.
 */
export async function upsertSnapshot(
  supabase: SupabaseClient,
  args: { date: string; payload: DashboardEntry; frozenBy: "cron" | "lazy" | "manual" }
): Promise<boolean> {
  const { error } = await supabase
    .from("card_snapshots")
    .insert({
      date: args.date,
      payload: args.payload,
      frozen_by: args.frozenBy,
    });
  if (error) {
    // Unique-constraint violation = "already snapshotted" = expected.
    if (error.code === "23505") return false;
    console.error("upsertSnapshot failed:", error.message, error.code);
    return false;
  }
  return true;
}
```

(The function is named `upsertSnapshot` to keep the verb consistent with the spec, but it deliberately performs an insert-only-if-missing — the spec explicitly forbids overwriting an already-frozen date.)

- [ ] **Step 2: Typecheck**

Run: `bun x tsc --noEmit`
Expected: clean. (The `payload: DashboardEntry` round-trip works because Postgres `jsonb` is `unknown`-shaped on read; we trust the writer to have stored the right shape and surface schema mismatches as runtime errors during render — same pragma the rest of the codebase uses.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase/queries.ts
git commit -m "feat(snapshots): add getSnapshotDates/getSnapshotsBetween/upsertSnapshot"
```

---

### Task 11: Extract `assembleDashboardEntry` helper

The current `dashboard/page.tsx` has the entry-construction logic inlined twice (once for management, once for EPO). Phase 3 needs it called from a third place (snapshot freeze). Pull it out so all three paths share one source of truth.

**Files:**
- Create: `src/lib/snapshot/assemble.ts`
- Create: `src/lib/snapshot/assemble.test.ts`
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Write failing tests for the pure assembler**

Create `src/lib/snapshot/assemble.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { assembleDashboardEntry } from "./assemble";
import type { ScheduleEntry } from "@/types/schedule";

const baseEntry = (date: string): ScheduleEntry => ({
  date,
  dayOfWeek: "Mon",
  confirmationStatus: "confirmed",
  teakNight: false,
  activity: "Studio",
  location: "LA",
  coPilot: "",
  flightInfo: "",
  departure: { airport: "", fbo: "", time: "" },
  arrival: { airport: "", fbo: "", time: "" },
  internationalPax: "",
  groundTransport: "",
  lodging: "",
  comments: "",
  rowId: "row1",
});

describe("assembleDashboardEntry", () => {
  test("returns null when no schedule row exists for the date", () => {
    const entry = assembleDashboardEntry("2026-04-28", {
      schedule: [baseEntry("2026-04-29")],
      transitionsByDate: new Map(),
      assignmentsByDate: new Map(),
      travelLegsByDate: new Map(),
      settingsMap: new Map(),
    });
    expect(entry).toBeNull();
  });

  test("merges all sources for the date", () => {
    const entry = assembleDashboardEntry("2026-04-28", {
      schedule: [baseEntry("2026-04-28")],
      transitionsByDate: new Map([
        ["2026-04-28", [{ person: "greg", title: "Studio", startsAt: "2026-04-28T09:00-07:00", tz: "America/Los_Angeles", eventId: "e1" }]],
      ]),
      assignmentsByDate: new Map([
        ["2026-04-28", [{ id: "u1", fullName: "Alice", email: "a@x" }]],
      ]),
      travelLegsByDate: new Map([
        ["2026-04-28", { pickup: { date: "2026-04-28", action: "Pick up", location: "LAX", time: "9am", companion: "", companionPrePositionFlight: "", teakFlight: "", companionReturnFlight: "" } }],
      ]),
      settingsMap: new Map([["2026-04-28", { detailLevel: "dual" }]]),
    });
    expect(entry).not.toBeNull();
    expect(entry!.detailLevel).toBe("dual");
    expect(entry!.assignedEpos).toHaveLength(1);
    expect(entry!.transitions).toHaveLength(1);
    expect(entry!.pickupLeg?.location).toBe("LAX");
    expect(entry!.dropoffLeg).toBeUndefined();
  });

  test("uses 'single' as the default detail level", () => {
    const entry = assembleDashboardEntry("2026-04-28", {
      schedule: [baseEntry("2026-04-28")],
      transitionsByDate: new Map(),
      assignmentsByDate: new Map(),
      travelLegsByDate: new Map(),
      settingsMap: new Map(),
    });
    expect(entry!.detailLevel).toBe("single");
  });
});
```

- [ ] **Step 2: Run — should fail with module not found**

Run: `bun test src/lib/snapshot/assemble.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the assembler**

Create `src/lib/snapshot/assemble.ts`:

```ts
import type {
  DashboardEntry,
  DetailLevel,
  Profile,
  ScheduleEntry,
  Transition,
  TravelLeg,
} from "@/types/schedule";

export interface DateLegs {
  pickup?: TravelLeg;
  dropoff?: TravelLeg;
}

export interface AssembleSources {
  schedule: ScheduleEntry[];
  transitionsByDate: Map<string, Transition[]>;
  assignmentsByDate: Map<string, Pick<Profile, "id" | "fullName" | "email">[]>;
  travelLegsByDate: Map<string, DateLegs>;
  settingsMap: Map<string, { detailLevel: DetailLevel }>;
}

/**
 * Build a single DashboardEntry by joining a schedule row with the
 * supplementary data for that date. Returns null when no schedule row
 * exists for `date`.
 *
 * This is the pure shape that both the live dashboard and the snapshot
 * freezer use — keeping it factored here means a snapshot is byte-for-byte
 * the same as a live render, which is the contract that lets us serve
 * past cards from snapshots without divergent rendering.
 */
export function assembleDashboardEntry(
  date: string,
  sources: AssembleSources
): DashboardEntry | null {
  const row = sources.schedule.find((s) => s.date === date);
  if (!row) return null;
  const setting = sources.settingsMap.get(date);
  const legs = sources.travelLegsByDate.get(date);
  return {
    ...row,
    detailLevel: setting?.detailLevel ?? "single",
    assignedEpos: sources.assignmentsByDate.get(date) ?? [],
    pickupLeg: legs?.pickup,
    dropoffLeg: legs?.dropoff,
    transitions: sources.transitionsByDate.get(date) ?? [],
  };
}
```

- [ ] **Step 4: Run tests — they should pass**

Run: `bun test src/lib/snapshot/assemble.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor `dashboard/page.tsx` to use the helper**

In `src/app/dashboard/page.tsx`, both the management and EPO branches currently inline the merge logic. Replace each `.map((s) => { ... return { ...s, detailLevel: ..., ... } })` block with a call to `assembleDashboardEntry`.

In the management branch (around line 154), change:

```ts
    const entries: DashboardEntry[] = schedule
      .filter((s) => s.date >= today)
      .map((s) => {
        const setting = settingsMap.get(s.date);
        const legs = travelLegsByDate.get(s.date);
        return {
          ...s,
          detailLevel: setting?.detailLevel ?? "single",
          assignedEpos: assignmentsByDate.get(s.date) ?? [],
          isPast: s.date < today,
          isThisWeek: isThisWeek(s.date),
          isNextWeek: isNextWeek(s.date),
          pickupLeg: legs?.pickup,
          dropoffLeg: legs?.dropoff,
          transitions: transitionsByDate.get(s.date) ?? [],
        };
      });
```

To:

```ts
    const entries: DashboardEntry[] = schedule
      .filter((s) => s.date >= today)
      .map((s) => {
        const base = assembleDashboardEntry(s.date, {
          schedule,
          transitionsByDate,
          assignmentsByDate,
          travelLegsByDate,
          settingsMap,
        })!; // safe: we just iterated over schedule
        return {
          ...base,
          isPast: s.date < today,
          isThisWeek: isThisWeek(s.date),
          isNextWeek: isNextWeek(s.date),
        };
      });
```

Do the equivalent rewrite in the EPO branch (around line 219). Add the import at the top:

```ts
import { assembleDashboardEntry } from "@/lib/snapshot/assemble";
```

- [ ] **Step 6: Typecheck + smoke**

Run: `bun x tsc --noEmit && bun dev`
Verify the dashboard renders identically (smoke check on a few cards).

- [ ] **Step 7: Commit**

```bash
git add src/lib/snapshot/assemble.ts src/lib/snapshot/assemble.test.ts src/app/dashboard/page.tsx
git commit -m "refactor(dashboard): extract assembleDashboardEntry; share between live and freeze"
```

---

### Task 12: Snapshot orchestration + endpoint

**Files:**
- Create: `src/lib/snapshot/freeze.ts`
- Create: `src/lib/snapshot/freeze.test.ts`
- Create: `src/app/api/snapshot/run/route.ts`

- [ ] **Step 1: Write failing tests for `runSnapshot` selection logic**

Create `src/lib/snapshot/freeze.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { selectMissingDatesForCron } from "./freeze";

describe("selectMissingDatesForCron", () => {
  test("returns the prior 7 days minus already-frozen", () => {
    const today = "2026-04-28";
    const existing = new Set(["2026-04-25", "2026-04-26"]);
    const result = selectMissingDatesForCron(today, existing);
    expect(result).toEqual([
      "2026-04-21",
      "2026-04-22",
      "2026-04-23",
      "2026-04-24",
      "2026-04-27",
    ]);
  });

  test("returns empty when all 7 days are already frozen", () => {
    const today = "2026-04-28";
    const existing = new Set([
      "2026-04-21",
      "2026-04-22",
      "2026-04-23",
      "2026-04-24",
      "2026-04-25",
      "2026-04-26",
      "2026-04-27",
    ]);
    expect(selectMissingDatesForCron(today, existing)).toEqual([]);
  });

  test("never includes today or future dates", () => {
    const today = "2026-04-28";
    const result = selectMissingDatesForCron(today, new Set());
    expect(result).not.toContain("2026-04-28");
    expect(result).not.toContain("2026-04-29");
  });
});
```

- [ ] **Step 2: Run — should fail**

Run: `bun test src/lib/snapshot/freeze.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the orchestration**

Create `src/lib/snapshot/freeze.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, datesBetween } from "@/lib/schedule-utils";
import { fetchSchedule } from "@/lib/google-sheets";
import { fetchTransitions } from "@/lib/google-calendar";
import {
  getAllAssignmentsWithProfiles,
  getDateSettings,
  getSnapshotDates,
  getTravelLegs,
  upsertSnapshot,
} from "@/lib/supabase/queries";
import { isoDateInTz } from "@/lib/schedule-utils";
import { assembleDashboardEntry, type AssembleSources, type DateLegs } from "./assemble";
import type { Profile, ScheduleEntry, Transition, TravelLeg } from "@/types/schedule";

const CRON_LOOKBACK_DAYS = 7;

/**
 * Pure: dates in [today-7, today-1] that are NOT in `existing`.
 * Caller passes in the set of already-snapshotted dates.
 */
export function selectMissingDatesForCron(
  today: string,
  existing: Set<string>
): string[] {
  const start = addDays(today, -CRON_LOOKBACK_DAYS);
  const end = addDays(today, -1);
  return datesBetween(start, end).filter((d) => !existing.has(d));
}

export interface RunSnapshotResult {
  snapshotted: string[];
  unrecoverable: string[];
  alreadyFrozen: string[];
}

/**
 * Capture missing snapshots in [today-7, today-1].
 * Used by both the nightly cron endpoint and (with a different `dates`
 * computation) the lazy backfill in the dashboard read path.
 */
export async function runSnapshotForCron(
  supabase: SupabaseClient,
  today: string
): Promise<RunSnapshotResult> {
  const candidates = datesBetween(addDays(today, -CRON_LOOKBACK_DAYS), addDays(today, -1));
  const existing = await getSnapshotDates(supabase, candidates);
  const missing = selectMissingDatesForCron(today, existing);

  const sources = await fetchAllLiveSources(supabase, today);

  return runSnapshotForDates(supabase, missing, sources, "cron", existing);
}

/**
 * Capture snapshots for a specific list of past dates using already-fetched
 * live sources. Used by the dashboard's lazy backfill path so we don't re-fetch
 * the sheet per request.
 */
export async function runSnapshotForDates(
  supabase: SupabaseClient,
  dates: string[],
  sources: AssembleSources,
  frozenBy: "cron" | "lazy",
  alreadyFrozen?: Set<string>
): Promise<RunSnapshotResult> {
  const result: RunSnapshotResult = {
    snapshotted: [],
    unrecoverable: [],
    alreadyFrozen: alreadyFrozen ? Array.from(alreadyFrozen) : [],
  };
  for (const date of dates) {
    const entry = assembleDashboardEntry(date, sources);
    if (!entry) {
      result.unrecoverable.push(date);
      continue;
    }
    const inserted = await upsertSnapshot(supabase, {
      date,
      payload: entry,
      frozenBy,
    });
    if (inserted) result.snapshotted.push(date);
    else result.unrecoverable.push(date); // already exists or insert failed
  }
  return result;
}

/**
 * Fetch every source the dashboard would, with no date filtering, so the
 * caller can re-key or join freely. The full sheet/calendar read-through
 * matches the existing dashboard fetch behavior.
 */
export async function fetchAllLiveSources(
  supabase: SupabaseClient,
  today: string
): Promise<AssembleSources> {
  const [schedule, dateSettingsRows, assignmentsRaw, travelLegsRaw] = await Promise.all([
    fetchSchedule(),
    getDateSettings(supabase),
    getAllAssignmentsWithProfiles(supabase),
    getTravelLegs(supabase),
  ]);

  // Transitions need a date range. Cover today-7 through whatever the
  // furthest sheet date is.
  const sheetMaxDate = schedule.reduce(
    (max, s) => (s.date > max ? s.date : max),
    today
  );
  const transitions: Transition[] =
    schedule.length === 0
      ? []
      : await fetchTransitions({
          startDate: addDays(today, -CRON_LOOKBACK_DAYS),
          endDate: sheetMaxDate,
        });

  // Bucket the raw rows just like dashboard/page.tsx does.
  const transitionsByDate = new Map<string, Transition[]>();
  for (const t of transitions) {
    const date = isoDateInTz(t.startsAt, t.tz);
    const list = transitionsByDate.get(date) ?? [];
    list.push(t);
    transitionsByDate.set(date, list);
  }

  const assignmentsByDate = new Map<
    string,
    Pick<Profile, "id" | "fullName" | "email">[]
  >();
  for (const a of assignmentsRaw) {
    const epoInfo = (a as { profiles: { id: string; full_name: string; email: string } | null }).profiles;
    if (!epoInfo) continue;
    const date = (a as { date: string }).date;
    const existing = assignmentsByDate.get(date) ?? [];
    existing.push({ id: epoInfo.id, fullName: epoInfo.full_name, email: epoInfo.email });
    assignmentsByDate.set(date, existing);
  }

  const travelLegsByDate = new Map<string, DateLegs>();
  for (const tl of travelLegsRaw) {
    const row = tl as {
      date: string; action: string; location: string; time: string; companion: string;
      companion_pre_position_flight: string; teak_flight: string; companion_return_flight: string;
    };
    const leg: TravelLeg = {
      date: row.date,
      action: row.action as TravelLeg["action"],
      location: row.location,
      time: row.time,
      companion: row.companion,
      companionPrePositionFlight: row.companion_pre_position_flight,
      teakFlight: row.teak_flight,
      companionReturnFlight: row.companion_return_flight,
    };
    const existing = travelLegsByDate.get(row.date) ?? {};
    if (leg.action === "Pick up") existing.pickup = leg;
    else if (leg.action === "Drop off") existing.dropoff = leg;
    travelLegsByDate.set(row.date, existing);
  }

  const settingsMap = new Map<string, { detailLevel: import("@/types/schedule").DetailLevel }>();
  for (const ds of dateSettingsRows as { date: string; detail_level: string }[]) {
    settingsMap.set(ds.date, { detailLevel: ds.detail_level as import("@/types/schedule").DetailLevel });
  }

  const sources: AssembleSources = {
    schedule: schedule as ScheduleEntry[],
    transitionsByDate,
    assignmentsByDate,
    travelLegsByDate,
    settingsMap,
  };
  return sources;
}
```

- [ ] **Step 4: Run tests — they should pass**

Run: `bun test src/lib/snapshot/freeze.test.ts`
Expected: PASS — `selectMissingDatesForCron` covered.

- [ ] **Step 5: Implement the API route**

Create `src/app/api/snapshot/run/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnchorDates } from "@/lib/schedule-utils";
import { runSnapshotForCron } from "@/lib/snapshot/freeze";

export async function POST(request: Request) {
  const expected = process.env.SNAPSHOT_CRON_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "Snapshot endpoint not configured" },
      { status: 503 }
    );
  }
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = await createClient();
    const { today } = getAnchorDates();
    const result = await runSnapshotForCron(supabase, today);
    console.log(
      `[snapshot/run] today=${today} snapshotted=${JSON.stringify(result.snapshotted)} unrecoverable=${JSON.stringify(result.unrecoverable)} already=${result.alreadyFrozen.length}`
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error("[snapshot/run] failed:", error);
    return NextResponse.json(
      { error: "Snapshot run failed", detail: String(error) },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 6: Add the env var to the local example**

Edit `.env.local.example`. Append at the bottom:

```
# Bearer token required by POST /api/snapshot/run.
# The systemd timer on Clipper sends this header. Generate with:
#   openssl rand -hex 32
# and store in /data/SecApp/shared/.env.production on the server.
SNAPSHOT_CRON_TOKEN=replace-with-32-hex-chars
```

- [ ] **Step 7: Smoke-test the endpoint locally**

Run: `bun dev` (in another terminal). Set `SNAPSHOT_CRON_TOKEN=test-token` in `.env.local`. Then:

```bash
curl -i -X POST http://localhost:3000/api/snapshot/run \
  -H "Authorization: Bearer test-token"
```

Expected: 200 with a JSON body containing `snapshotted`, `unrecoverable`, `alreadyFrozen`. Confirm in Supabase that any newly-snapshotted dates appear in `card_snapshots`.

Try without the header — expect 401.
Try with a wrong token — expect 401.

- [ ] **Step 8: Commit**

```bash
git add src/lib/snapshot/freeze.ts src/lib/snapshot/freeze.test.ts src/app/api/snapshot/run/route.ts .env.local.example
git commit -m "feat(snapshots): add runSnapshotForCron orchestration and /api/snapshot/run endpoint"
```

---

## Phase 4 — Read-path split + lazy backfill

### Task 13: `parseRangeFromSearchParams` + URL param handling

**Files:**
- Create: `src/lib/dashboard/range.ts`
- Create: `src/lib/dashboard/range.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/dashboard/range.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { parseRangeFromSearchParams } from "./range";

describe("parseRangeFromSearchParams", () => {
  test("returns management default (today..today+30) when nothing provided", () => {
    const range = parseRangeFromSearchParams({}, { today: "2026-04-28", role: "management" });
    expect(range).toEqual({ start: "2026-04-28", end: "2026-05-28" });
  });

  test("returns EPO default (today-7..today+30) when nothing provided", () => {
    const range = parseRangeFromSearchParams({}, { today: "2026-04-28", role: "epo" });
    expect(range).toEqual({ start: "2026-04-21", end: "2026-05-28" });
  });

  test("uses both ?start= and ?end= when both valid", () => {
    const range = parseRangeFromSearchParams(
      { start: "2026-03-01", end: "2026-03-15" },
      { today: "2026-04-28", role: "management" }
    );
    expect(range).toEqual({ start: "2026-03-01", end: "2026-03-15" });
  });

  test("falls back to default when ?start= is malformed", () => {
    const range = parseRangeFromSearchParams(
      { start: "not-a-date", end: "2026-03-15" },
      { today: "2026-04-28", role: "management" }
    );
    expect(range.start).toBe("2026-04-28");
  });

  test("swaps when start > end", () => {
    const range = parseRangeFromSearchParams(
      { start: "2026-04-30", end: "2026-04-20" },
      { today: "2026-04-28", role: "management" }
    );
    expect(range).toEqual({ start: "2026-04-20", end: "2026-04-30" });
  });

  test("treats single ?date= as a 1-day range", () => {
    const range = parseRangeFromSearchParams(
      { date: "2026-04-28" },
      { today: "2026-04-28", role: "management" }
    );
    expect(range).toEqual({ start: "2026-04-28", end: "2026-04-28" });
  });
});
```

- [ ] **Step 2: Run — should fail**

Run: `bun test src/lib/dashboard/range.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/lib/dashboard/range.ts`:

```ts
import { addDays } from "@/lib/schedule-utils";

export type Role = "epo" | "management";

export interface DateRange {
  start: string;
  end: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function defaultRange(today: string, role: Role): DateRange {
  const start = role === "epo" ? addDays(today, -7) : today;
  return { start, end: addDays(today, 30) };
}

function isValidIsoDate(s: string | undefined): s is string {
  if (!s) return false;
  if (!ISO_DATE_RE.test(s)) return false;
  // Reject "2026-13-01" and similar.
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Defensive parse of the dashboard URL params. Falls back to the role's
 * default range on any garbage input. Swaps when start > end.
 *
 * Supports:
 *   ?start=YYYY-MM-DD&end=YYYY-MM-DD  (range)
 *   ?date=YYYY-MM-DD                  (single-day shorthand; equivalent to start=end)
 */
export function parseRangeFromSearchParams(
  params: Record<string, string | string[] | undefined>,
  ctx: { today: string; role: Role }
): DateRange {
  const get = (key: string): string | undefined => {
    const v = params[key];
    return Array.isArray(v) ? v[0] : v;
  };

  const date = get("date");
  if (date && isValidIsoDate(date)) {
    return { start: date, end: date };
  }

  const start = get("start");
  const end = get("end");
  const startValid = isValidIsoDate(start);
  const endValid = isValidIsoDate(end);

  if (!startValid && !endValid) return defaultRange(ctx.today, ctx.role);

  const fallback = defaultRange(ctx.today, ctx.role);
  let s = startValid ? start! : fallback.start;
  let e = endValid ? end! : fallback.end;
  if (s > e) [s, e] = [e, s];
  return { start: s, end: e };
}
```

- [ ] **Step 4: Run tests — they should pass**

Run: `bun test src/lib/dashboard/range.test.ts`
Expected: PASS — all 6.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard/range.ts src/lib/dashboard/range.test.ts
git commit -m "feat(dashboard): parseRangeFromSearchParams with role-aware defaults"
```

---

### Task 14: Refactor `dashboard/page.tsx` — split past from live

This is the big read-path change. The page becomes "given a range, fetch snapshots for past, fetch live for today+future, merge, render."

**Files:**
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Read the URL params + compute the range**

In `src/app/dashboard/page.tsx`, change the function signature to accept `searchParams` (Next.js 16 App Router):

```ts
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();

  let profile;
  try {
    profile = await getProfile(supabase);
  } catch {
    redirect("/login");
  }

  if (!profile) {
    redirect("/login");
  }

  const { today, tomorrow } = getAnchorDates();
  const params = await searchParams;
  const range = parseRangeFromSearchParams(params, {
    today,
    role: profile.role as "epo" | "management",
  });
  const isManagement = profile.role === "management";
```

Add the import:

```ts
import { parseRangeFromSearchParams } from "@/lib/dashboard/range";
```

- [ ] **Step 2: Replace the unconditional live-data fetch with a range-aware split**

Below the `range` computation, replace the existing parallel fetches and per-branch logic with a unified flow. The whole rest of the function gets rewritten — show the new shape:

```ts
  const liveStart = range.end >= today ? today : null;
  const liveEnd = range.end >= today ? range.end : null;
  const pastStart = range.start < today ? range.start : null;
  const pastEnd = range.start < today ? minDate(range.end, addDays(today, -1)) : null;

  // Live sources (full sheet/calendar read for whatever we need to render
  // and what lazy backfill might consume).
  const liveSourcesPromise = liveStart !== null
    ? fetchAllLiveSources(supabase, today)
    : Promise.resolve(null);

  const snapshotsPromise = pastStart !== null && pastEnd !== null
    ? getSnapshotsBetween(supabase, pastStart, pastEnd)
    : Promise.resolve([]);

  const [liveSources, snapshotsRaw] = await Promise.all([
    liveSourcesPromise,
    snapshotsPromise,
  ]);

  // Lazy backfill any past gaps in the requested range.
  let backfilled: typeof snapshotsRaw = [];
  if (pastStart !== null && pastEnd !== null && liveSources) {
    const have = new Set(snapshotsRaw.map((s) => s.date));
    const requestedPast = datesBetween(pastStart, pastEnd);
    const missing = requestedPast.filter((d) => !have.has(d));
    if (missing.length > 0) {
      const result = await runSnapshotForDates(
        supabase,
        missing,
        liveSources,
        "lazy"
      );
      if (result.snapshotted.length > 0) {
        const fresh = await getSnapshotsBetween(supabase, pastStart, pastEnd);
        backfilled = fresh.filter((s) => !have.has(s.date));
      }
    }
  }
  const allSnapshots = [...snapshotsRaw, ...backfilled];

  // EPO-specific data still needed for highlighting "my assignments".
  const myAssignments = !isManagement
    ? await getAssignmentsForUser(supabase, profile.id)
    : [];
  const assignedDates = myAssignments.map((a: { date: string }) => a.date);
  const assignedDateSet = new Set(assignedDates);

  // Build past entries from snapshots (already complete DashboardEntry
  // payloads — just stamp `isPast: true`).
  const pastEntries: DashboardEntry[] = allSnapshots.map((s) => ({
    ...s.payload,
    isPast: true,
    isFromSnapshot: true,
    isThisWeek: isThisWeek(s.date),
    isNextWeek: isNextWeek(s.date),
  }));

  // Build live entries from sources for [today..range.end].
  const liveEntries: DashboardEntry[] = (() => {
    if (liveStart === null || liveEnd === null || !liveSources) return [];
    return liveSources.schedule
      .filter((s) => s.date >= liveStart && s.date <= liveEnd)
      .map((s) => {
        const base = assembleDashboardEntry(s.date, liveSources)!;
        const epoLegs = !isManagement && !assignedDateSet.has(s.date)
          ? { pickupLeg: undefined, dropoffLeg: undefined }
          : {};
        return {
          ...base,
          ...epoLegs,
          isPast: false,
          isThisWeek: isThisWeek(s.date),
          isNextWeek: isNextWeek(s.date),
        };
      });
  })();

  // Missing past placeholders — past dates the user explicitly asked for
  // that have neither a snapshot nor a live row.
  const haveDates = new Set([
    ...pastEntries.map((e) => e.date),
    ...liveEntries.map((e) => e.date),
  ]);
  const missingPast: DashboardEntry[] =
    pastStart !== null && pastEnd !== null
      ? datesBetween(pastStart, pastEnd)
          .filter((d) => !haveDates.has(d))
          .map((d) => emptyMissingEntry(d))
      : [];

  const entries = [...pastEntries, ...missingPast, ...liveEntries].sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  if (isManagement) {
    const epos = await getAllEpos(supabase, profile.id);
    return (
      <ManagementDashboard
        entries={entries}
        epos={epos.map((e: { id: string; full_name: string; email: string }) => ({
          id: e.id,
          fullName: e.full_name,
          email: e.email,
        }))}
        profileId={profile.id}
        todayISO={today}
        tomorrowISO={tomorrow}
        range={range}
      />
    );
  }

  return (
    <EpoDashboard
      entries={entries}
      assignedDates={assignedDates}
      userName={profile.fullName}
      todayISO={today}
      tomorrowISO={tomorrow}
      range={range}
    />
  );
}
```

Update imports at the top of the file:

```ts
import { addDays, datesBetween, getAnchorDates, isNextWeek, isThisWeek, minDate } from "@/lib/schedule-utils";
import { assembleDashboardEntry } from "@/lib/snapshot/assemble";
import { fetchAllLiveSources, runSnapshotForDates } from "@/lib/snapshot/freeze";
import { getSnapshotsBetween } from "@/lib/supabase/queries";
```

(Drop unused imports — `fetchSchedule`, `fetchTransitions`, `getDateSettings`, `getAllAssignmentsWithProfiles`, `getTravelLegs`, the `toTravelLegsMap` helper, `buildTransitionsByDate` — these all moved into `fetchAllLiveSources`. Remove them.)

Add the `emptyMissingEntry` helper either at the bottom of the page file or in `src/lib/snapshot/assemble.ts`. Putting it in `assemble.ts` keeps related shape concerns together:

In `src/lib/snapshot/assemble.ts`, append:

```ts
/**
 * Placeholder entry for a past date the user picked but for which we have
 * no snapshot and no surviving live row. Renders as a "?" card.
 */
export function emptyMissingEntry(date: string): import("@/types/schedule").DashboardEntry {
  return {
    date,
    dayOfWeek: "",
    confirmationStatus: "unconfirmed",
    teakNight: false,
    activity: "",
    location: "",
    coPilot: "",
    flightInfo: "",
    departure: { airport: "", fbo: "", time: "" },
    arrival: { airport: "", fbo: "", time: "" },
    internationalPax: "",
    groundTransport: "",
    lodging: "",
    comments: "",
    rowId: `missing-${date}`,
    detailLevel: "single",
    assignedEpos: [],
    transitions: [],
    isPast: true,
    isMissing: true,
  };
}
```

Add the import in `dashboard/page.tsx`:

```ts
import { assembleDashboardEntry, emptyMissingEntry } from "@/lib/snapshot/assemble";
```

- [ ] **Step 3: Update `ManagementDashboard` and `EpoDashboard` to accept the `range` prop**

`src/app/dashboard/management-dashboard.tsx` and `src/app/dashboard/epo-dashboard.tsx` both need a new optional `range?: { start: string; end: string }` prop. They don't have to do anything with it yet — Phase 5 wires it into the picker — but we add the prop to keep the page's call green.

Open each file, find the props interface, add:

```ts
  range: { start: string; end: string };
```

(Ignore the `range` value for now; we'll thread it down to `DashboardFilters` in Task 20.)

- [ ] **Step 4: Typecheck + smoke**

Run: `bun x tsc --noEmit`
Expected: clean.

`bun dev`. Test:
- Default load: dashboard renders today + 30 (management) or today-7 + 30 (EPO). No console errors.
- Append `?start=2026-04-21&end=2026-04-26` to the URL: dashboard renders only those past dates from snapshots (or `?` placeholders if none exist). Backfill should fire for any past dates that still have a sheet row → check Supabase to see new `frozen_by='lazy'` rows.
- Append `?start=2026-04-21&end=2026-05-15`: dashboard renders past snapshots + live future cards together, sorted by date.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/page.tsx src/app/dashboard/management-dashboard.tsx src/app/dashboard/epo-dashboard.tsx src/lib/snapshot/assemble.ts
git commit -m "feat(dashboard): split past/live by date with lazy snapshot backfill"
```

---

### Task 15: Render the `isMissing` placeholder card

The placeholder appears wherever a `DashboardEntry` flows through the existing card components. We need a tiny rendering branch in both `ManagementCard` and the EPO card so neither tries to render a fully-empty schedule row.

**Files:**
- Modify: `src/components/management-card.tsx`
- Modify: `src/components/schedule-detail-card.tsx`

- [ ] **Step 1: Add the `MissingCard` component**

Create a new file `src/components/missing-card.tsx`:

```tsx
import type { DashboardEntry } from "@/types/schedule";
import { formatDateHeader } from "@/lib/schedule-utils";

export function MissingCard({
  entry,
  todayISO,
  tomorrowISO,
}: {
  entry: DashboardEntry;
  todayISO: string;
  tomorrowISO: string;
}) {
  return (
    <div
      className="rounded-lg border-l-3 border-dashed border-gray-700 bg-gray-900/50 p-3"
      title="No snapshot was captured for this date. The source row was likely deleted before the nightly snapshot or any dashboard load could capture it."
    >
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-gray-500">
          {formatDateHeader(entry.date, todayISO, tomorrowISO)}
        </div>
        <div className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-500">
          ? no snapshot
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Branch on `isMissing` in management-card.tsx**

In `src/components/management-card.tsx`, near the top of the `ManagementCard` function (before the existing `return`), add:

```tsx
import { MissingCard } from "./missing-card";
```

```tsx
  if (entry.isMissing) {
    return <MissingCard entry={entry} todayISO={/* threaded from parent */} tomorrowISO={/* same */} />;
  }
```

To pass `todayISO` / `tomorrowISO` cleanly, accept them as props. Update the signature:

```tsx
export function ManagementCard({
  entry,
  allEpos,
  profileId,
  todayISO,
  tomorrowISO,
}: {
  entry: DashboardEntry;
  allEpos: EpoInfo[];
  profileId: string;
  todayISO: string;
  tomorrowISO: string;
}) {
```

Update the call site in `src/app/dashboard/management-dashboard.tsx` to pass `todayISO={todayISO}` and `tomorrowISO={tomorrowISO}` to every `<ManagementCard>`.

- [ ] **Step 3: Branch on `isMissing` in `schedule-detail-card.tsx`**

Same pattern in `src/components/schedule-detail-card.tsx`. Add the `MissingCard` import and an early return at the top of the rendering function:

```tsx
import { MissingCard } from "./missing-card";
```

```tsx
  if (entry.isMissing) {
    return <MissingCard entry={entry} todayISO={todayISO} tomorrowISO={tomorrowISO} />;
  }
```

Confirm `todayISO` and `tomorrowISO` are already props on this component (they're passed from `EpoDashboard` for `formatDateHeader`). If not, add them.

- [ ] **Step 4: Typecheck + smoke**

Run: `bun x tsc --noEmit`
Expected: clean.

`bun dev`. Append `?start=2025-01-01&end=2025-01-03` to the URL — dates the system has never seen. Expected: three "? no snapshot" placeholders. (The dates won't be in the sheet either, so no live row exists; this is the genuine `isMissing` path.)

- [ ] **Step 5: Commit**

```bash
git add src/components/missing-card.tsx src/components/management-card.tsx src/components/schedule-detail-card.tsx src/app/dashboard/management-dashboard.tsx
git commit -m "feat(dashboard): render placeholder card for past dates with no snapshot"
```

---

### Task 16: EPO dashboard — accept `range` and stop double-filtering past

The EPO dashboard has a "past assignments" filter pill that uses `e.isPast`. After Phase 4, `isPast` reflects the *picker* range, not the auto rolling window. Confirm the filter pill still behaves sensibly and remove the unused `filterRollingWindow` helper.

**Files:**
- Modify: `src/app/dashboard/epo-dashboard.tsx`
- Modify: `src/lib/schedule-utils.ts`

- [ ] **Step 1: Remove `filterRollingWindow`**

The function is defined and never called (verified during spec review). Delete the function, its `PAST_DAYS` and `FUTURE_DAYS` constants. Open `src/lib/schedule-utils.ts` and remove:

```ts
const PAST_DAYS = 7;
const FUTURE_DAYS = 30;
```

```ts
/**
 * Filter schedule entries to a rolling window around today.
 */
export function filterRollingWindow(
  entries: ScheduleEntry[]
): ScheduleEntry[] {
  ...
}
```

Search for any callers (none expected):

```bash
grep -rn "filterRollingWindow\|PAST_DAYS\|FUTURE_DAYS" /Users/aj/Desktop/Projects/Workspace/speedero-security/src/
```

If grep returns hits, address them. Otherwise the deletion is clean.

- [ ] **Step 2: Confirm the EPO "past-assignments" filter still makes sense**

Open `src/app/dashboard/epo-dashboard.tsx` (lines 43, 52). The filter currently does:

```ts
case "all-future":  // or whatever the default branch is
  result = result.filter((e) => !e.isPast);
case "past-assignments":
  result = result.filter((e) => e.isPast);
```

After Phase 4, `e.isPast` is set from snapshot reads (true) and live reads (false). The pill's behavior — "show me past entries from the current range" — is still correct. No code change needed. Add a brief comment to make the contract explicit:

```ts
// `e.isPast` is set by page.tsx from the date+today comparison. Snapshots
// always have isPast=true; live entries always have isPast=false. The
// picker range determines which dates appear in `entries` — this filter
// just narrows further to the past subset.
```

- [ ] **Step 3: Typecheck**

Run: `bun x tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/schedule-utils.ts src/app/dashboard/epo-dashboard.tsx
git commit -m "chore(epo-dashboard): remove dead filterRollingWindow; document isPast contract"
```

---

## Phase 5 — Date picker UI

### Task 17: `DateRangeControl` — closed trigger button

Build the component incrementally. This task lands the closed `[📅] Mar 12 → Mar 18` button with no popover yet, wired into URL params via the existing pattern.

**Files:**
- Create: `src/components/date-range-control.tsx`
- Modify: `src/components/dashboard-filters.tsx`

- [ ] **Step 1: Implement the closed button**

Create `src/components/date-range-control.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { DateRange } from "@/lib/dashboard/range";

function formatLabel(range: DateRange): string {
  const fmt = (iso: string) => {
    const [, m, d] = iso.split("-");
    const month = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(m) - 1];
    return `${month} ${Number(d)}`;
  };
  if (range.start === range.end) return fmt(range.start);
  return `${fmt(range.start)} → ${fmt(range.end)}`;
}

export function DateRangeControl({ range }: { range: DateRange }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function applyRange(next: DateRange) {
    const sp = new URLSearchParams(params.toString());
    sp.set("start", next.start);
    sp.set("end", next.end);
    sp.delete("date");
    router.push(`${pathname}?${sp.toString()}`);
    setOpen(false);
  }

  return (
    <div className="relative">
      <div className="inline-flex items-center overflow-hidden rounded-md bg-gray-800 ring-1 ring-gray-700">
        <button
          onClick={() => setOpen(!open)}
          className={`px-2 py-1.5 text-xs transition-colors border-r border-gray-700 ${
            open ? "bg-blue-700 text-white" : "text-gray-400 hover:bg-gray-700"
          }`}
          aria-label="Toggle date picker"
        >
          📅
        </button>
        <button
          onClick={() => setOpen(true)}
          className="px-2.5 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
        >
          {formatLabel(range)}
        </button>
      </div>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-72 rounded-md bg-gray-900 p-3 shadow-lg ring-1 ring-gray-700">
          <div className="text-xs text-gray-400">
            Calendar grid lands in Task 18.
          </div>
          {/* TEMP — remove in Task 18: */}
          <button
            onClick={() => applyRange({ start: range.start, end: range.end })}
            className="mt-2 rounded bg-blue-700 px-2 py-1 text-xs text-white"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
```

Note the placeholder content in the popover — it gets replaced in Task 18. The `applyRange` helper is the shape we'll consume from the calendar.

- [ ] **Step 2: Wire into `DashboardFilters`**

In `src/components/dashboard-filters.tsx`, add the `range` prop and render the new control between the pills and the search input. Modify the existing `DashboardFilters` signature:

```tsx
import { DateRangeControl } from "./date-range-control";
import type { DateRange } from "@/lib/dashboard/range";

export function DashboardFilters({
  active,
  onChange,
  searchQuery,
  onSearchChange,
  filters = DEFAULT_FILTERS,
  range,
}: {
  active: FilterOption;
  onChange: (filter: FilterOption) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filters?: FilterDef[];
  range: DateRange;
}) {
```

Replace the JSX body to insert the control:

```tsx
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex gap-1.5">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => onChange(f.value)}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              active === f.value
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

- [ ] **Step 3: Thread `range` down through dashboards**

In `src/app/dashboard/management-dashboard.tsx` and `src/app/dashboard/epo-dashboard.tsx`, find the `<DashboardFilters>` usage and pass `range={range}`. Both dashboards already accept `range` from page.tsx (added in Task 14).

- [ ] **Step 4: Typecheck + smoke**

Run: `bun x tsc --noEmit && bun dev`
Expected: button renders next to the search input. Clicking the icon opens a placeholder popover.

- [ ] **Step 5: Commit**

```bash
git add src/components/date-range-control.tsx src/components/dashboard-filters.tsx src/app/dashboard/management-dashboard.tsx src/app/dashboard/epo-dashboard.tsx
git commit -m "feat(dashboard-filters): add DateRangeControl trigger button"
```

---

### Task 18: Popover month grid

Replace the placeholder popover with a month grid that supports prev/next month navigation and renders the currently-selected range.

**Files:**
- Modify: `src/components/date-range-control.tsx`

- [ ] **Step 1: Add a `MonthGrid` subcomponent**

In `src/components/date-range-control.tsx`, add the grid below the existing `DateRangeControl`:

```tsx
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const WEEKDAYS = ["S","M","T","W","T","F","S"];

interface MonthGridProps {
  /** First-of-month for the displayed page, ISO YYYY-MM-01. */
  monthStart: string;
  range: DateRange;
  onDayClick: (iso: string) => void;
}

function pad(n: number): string { return String(n).padStart(2, "0"); }

function MonthGrid({ monthStart, range, onDayClick }: MonthGridProps) {
  const [yearStr, monthStr] = monthStart.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr); // 1-based
  const firstWeekdayUtc = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0..6
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  // Build a flat array of cells: leading blanks + days.
  const cells: ({ iso: string; day: number } | null)[] = [];
  for (let i = 0; i < firstWeekdayUtc; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ iso: `${year}-${pad(month)}-${pad(d)}`, day: d });
  }

  function classFor(iso: string): string {
    const isStart = iso === range.start;
    const isEnd = iso === range.end;
    const inRange = iso > range.start && iso < range.end;
    if (isStart && isEnd) return "bg-blue-600 text-white rounded";
    if (isStart) return "bg-blue-600 text-white rounded-l";
    if (isEnd) return "bg-blue-600 text-white rounded-r";
    if (inRange) return "bg-blue-900 text-blue-100";
    return "text-gray-400 hover:bg-gray-800 rounded";
  }

  return (
    <div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-gray-500 mb-1">
        {WEEKDAYS.map((w, i) => (<div key={i}>{w}</div>))}
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-xs">
        {cells.map((c, i) => c === null ? (
          <div key={`blank-${i}`} />
        ) : (
          <button
            key={c.iso}
            onClick={() => onDayClick(c.iso)}
            className={`py-1 ${classFor(c.iso)}`}
          >
            {c.day}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace the placeholder popover with the grid**

Inside `DateRangeControl`, manage the displayed month in state. Replace the popover JSX (the `{open && ...}` block) with:

```tsx
      {open && (
        <PopoverContents
          range={range}
          onApply={applyRange}
          onClose={() => setOpen(false)}
        />
      )}
```

Add a `PopoverContents` component below `DateRangeControl`:

```tsx
function PopoverContents({
  range,
  onApply,
  onClose,
}: {
  range: DateRange;
  onApply: (next: DateRange) => void;
  onClose: () => void;
}) {
  const [monthStart, setMonthStart] = useState(() => {
    const [y, m] = range.start.split("-");
    return `${y}-${m}-01`;
  });

  function shiftMonth(delta: number) {
    const [y, m] = monthStart.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1 + delta, 1));
    setMonthStart(`${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-01`);
  }

  const [year, mm] = monthStart.split("-");
  const monthLabel = `${MONTH_NAMES[Number(mm) - 1]} ${year}`;

  return (
    <div className="absolute right-0 top-full z-10 mt-1 w-72 rounded-md bg-gray-900 p-3 shadow-lg ring-1 ring-gray-700">
      <div className="mb-2 flex items-center justify-between">
        <button onClick={() => shiftMonth(-1)} className="px-2 text-gray-400 hover:text-gray-100">‹</button>
        <div className="text-xs font-semibold text-gray-200">{monthLabel}</div>
        <button onClick={() => shiftMonth(1)} className="px-2 text-gray-400 hover:text-gray-100">›</button>
      </div>
      <MonthGrid
        monthStart={monthStart}
        range={range}
        onDayClick={(iso) => {
          // Click pattern handled in Task 19. For now: single-day select.
          onApply({ start: iso, end: iso });
        }}
      />
      <div className="mt-3 flex gap-1">
        <button onClick={onClose} className="flex-1 rounded bg-gray-800 py-1 text-xs text-gray-400 hover:bg-gray-700">Close</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Smoke**

`bun dev`. Click the icon, see the month grid. Use ‹/› to switch months. Click a day — the URL updates to `?start=...&end=...` with the same date for start and end (single-day range). The dashboard re-renders showing only that day.

- [ ] **Step 4: Commit**

```bash
git add src/components/date-range-control.tsx
git commit -m "feat(date-picker): popover month grid with prev/next navigation"
```

---

### Task 19: Range-selection click pattern + presets

Implement the Kayak-style click flow (first click = start, second = end, third = restart) and add the quick-preset row.

**Files:**
- Modify: `src/components/date-range-control.tsx`

- [ ] **Step 1: Track selection state inside the popover**

Refactor `PopoverContents` so day clicks build up a pending range. Replace the existing function with:

```tsx
function PopoverContents({
  range,
  onApply,
  onClose,
}: {
  range: DateRange;
  onApply: (next: DateRange) => void;
  onClose: () => void;
}) {
  const [monthStart, setMonthStart] = useState(() => {
    const [y, m] = range.start.split("-");
    return `${y}-${m}-01`;
  });
  // pendingStart=null means "next click sets start"; pendingStart!=null
  // means "next click sets end" (Kayak-style two-click range).
  const [pendingStart, setPendingStart] = useState<string | null>(null);

  function shiftMonth(delta: number) {
    const [y, m] = monthStart.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1 + delta, 1));
    setMonthStart(`${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-01`);
  }

  function handleDayClick(iso: string) {
    if (pendingStart === null) {
      // First click: set start, clear end (visualize a 1-day range until the
      // user clicks a second day).
      setPendingStart(iso);
      onApply({ start: iso, end: iso });
      return;
    }
    // Second click: complete the range. Swap if user clicked earlier.
    const start = pendingStart < iso ? pendingStart : iso;
    const end = pendingStart < iso ? iso : pendingStart;
    setPendingStart(null);
    onApply({ start, end });
    onClose();
  }

  const [year, mm] = monthStart.split("-");
  const monthLabel = `${MONTH_NAMES[Number(mm) - 1]} ${year}`;
  const displayRange = pendingStart !== null
    ? { start: pendingStart, end: pendingStart }
    : range;

  return (
    <div className="absolute right-0 top-full z-10 mt-1 w-72 rounded-md bg-gray-900 p-3 shadow-lg ring-1 ring-gray-700">
      <div className="mb-2 flex items-center justify-between">
        <button onClick={() => shiftMonth(-1)} className="px-2 text-gray-400 hover:text-gray-100">‹</button>
        <div className="text-xs font-semibold text-gray-200">{monthLabel}</div>
        <button onClick={() => shiftMonth(1)} className="px-2 text-gray-400 hover:text-gray-100">›</button>
      </div>
      <MonthGrid
        monthStart={monthStart}
        range={displayRange}
        onDayClick={handleDayClick}
      />
      <PresetRow onPick={(r) => { setPendingStart(null); onApply(r); onClose(); }} />
      <div className="mt-1 text-center text-[10px] text-gray-600">
        {pendingStart === null ? "Click to set start" : "Click to set end"}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the preset row**

Append a `PresetRow` component below `PopoverContents`:

```tsx
function todayIso(): string {
  // The popover runs in the browser; TZ-correct enough for human selection
  // (the server is the authority on `today` for filtering).
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function addDaysBrowser(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function PresetRow({ onPick }: { onPick: (r: DateRange) => void }) {
  const t = todayIso();
  const presets: { label: string; range: DateRange }[] = [
    { label: "Today",        range: { start: t, end: t } },
    { label: "This week",    range: { start: t, end: addDaysBrowser(t, 6) } },
    { label: "Last week",    range: { start: addDaysBrowser(t, -7), end: addDaysBrowser(t, -1) } },
    { label: "Past 30 days", range: { start: addDaysBrowser(t, -30), end: addDaysBrowser(t, -1) } },
  ];
  return (
    <div className="mt-3 grid grid-cols-2 gap-1">
      {presets.map((p) => (
        <button
          key={p.label}
          onClick={() => onPick(p.range)}
          className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Smoke-test the full flow**

`bun dev`. Click the icon. Click a day → start visualizes as a 1-day range. Click another day → range fills in, popover closes, URL updates, dashboard re-renders. Click "Past 30 days" → popover closes, URL updates to last month's range. Verify the in-between days highlight correctly (background color).

- [ ] **Step 4: Commit**

```bash
git add src/components/date-range-control.tsx
git commit -m "feat(date-picker): two-click range selection + quick presets"
```

---

### Task 20: Close on outside-click + URL state polish

Final polish on the picker. Outside-click closes the popover. The picker also resets `pendingStart` if the user re-opens after a half-finished selection.

**Files:**
- Modify: `src/components/date-range-control.tsx`

- [ ] **Step 1: Add an outside-click closer**

In `DateRangeControl`, add a wrapping container and an effect that listens for clicks outside it. Replace the existing `DateRangeControl` body with:

```tsx
import { useEffect, useRef } from "react";

// (... DateRange + formatLabel stay the same ...)

export function DateRangeControl({ range }: { range: DateRange }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handler(ev: MouseEvent) {
      if (!containerRef.current) return;
      if (containerRef.current.contains(ev.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function applyRange(next: DateRange) {
    const sp = new URLSearchParams(params.toString());
    sp.set("start", next.start);
    sp.set("end", next.end);
    sp.delete("date");
    router.push(`${pathname}?${sp.toString()}`);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="inline-flex items-center overflow-hidden rounded-md bg-gray-800 ring-1 ring-gray-700">
        <button
          onClick={() => setOpen(!open)}
          className={`px-2 py-1.5 text-xs transition-colors border-r border-gray-700 ${
            open ? "bg-blue-700 text-white" : "text-gray-400 hover:bg-gray-700"
          }`}
          aria-label="Toggle date picker"
        >
          📅
        </button>
        <button
          onClick={() => setOpen(true)}
          className="px-2.5 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
        >
          {formatLabel(range)}
        </button>
      </div>
      {open && (
        <PopoverContents
          range={range}
          onApply={applyRange}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Smoke**

`bun dev`. Open the picker. Click anywhere outside it (e.g., on a card header or empty space) — popover closes. Click the icon again — popover opens fresh, no half-state.

- [ ] **Step 3: Commit**

```bash
git add src/components/date-range-control.tsx
git commit -m "feat(date-picker): close popover on outside click"
```

---

## Phase 6 — Deployment

### Task 21: Systemd service + timer files

These are config files. The agent only writes them; AJ installs them on Clipper.

**Files:**
- Create: `scripts/deploy/speedero-snapshot.service`
- Create: `scripts/deploy/speedero-snapshot.timer`

- [ ] **Step 1: Create the service unit**

Create `scripts/deploy/speedero-snapshot.service`:

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

- [ ] **Step 2: Create the timer unit**

Create `scripts/deploy/speedero-snapshot.timer`:

```ini
[Unit]
Description=Run nightly snapshot at 00:30 PT

[Timer]
OnCalendar=*-*-* 00:30:00 America/Los_Angeles
Persistent=true

[Install]
WantedBy=timers.target
```

- [ ] **Step 3: Commit**

```bash
git add scripts/deploy/speedero-snapshot.service scripts/deploy/speedero-snapshot.timer
git commit -m "feat(deploy): systemd timer + service for nightly snapshot"
```

---

### Task 22: SETUP.md updates

Document the install steps and the env var.

**Files:**
- Modify: `scripts/deploy/SETUP.md`

- [ ] **Step 1: Append a snapshot section to SETUP.md**

Open `scripts/deploy/SETUP.md`. Append at the bottom:

```markdown
## Nightly snapshot timer

The dashboard freezes past cards into `card_snapshots` via a systemd timer that POSTs to a loopback endpoint nightly. Install on Clipper once:

1. Generate a token and add it to the env file:
   ```bash
   token=$(openssl rand -hex 32)
   echo "SNAPSHOT_CRON_TOKEN=$token" | sudo tee -a /data/SecApp/shared/.env.production
   ```
2. Restart the app so it picks up the new var:
   ```bash
   sudo systemctl restart speedero-security
   ```
3. Install the timer + service units:
   ```bash
   sudo cp /data/SecApp/current/scripts/deploy/speedero-snapshot.service /etc/systemd/system/
   sudo cp /data/SecApp/current/scripts/deploy/speedero-snapshot.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now speedero-snapshot.timer
   ```
4. Sanity-check:
   ```bash
   systemctl list-timers speedero-snapshot.timer
   sudo systemctl start speedero-snapshot.service   # fire once, immediately
   sudo journalctl -u speedero-snapshot --since "5 min ago"
   ```
   Expected log line includes `snapshotted=[...]` etc.

### Token rotation

Both `speedero-security.service` and `speedero-snapshot.service` load `/data/SecApp/shared/.env.production`. To rotate:

```bash
new_token=$(openssl rand -hex 32)
sudo sed -i "s/^SNAPSHOT_CRON_TOKEN=.*/SNAPSHOT_CRON_TOKEN=$new_token/" /data/SecApp/shared/.env.production
sudo systemctl restart speedero-security
# The timer will pick up the new token on its next fire; no restart needed for the timer itself.
```
```

- [ ] **Step 2: Commit**

```bash
git add scripts/deploy/SETUP.md
git commit -m "docs(deploy): document snapshot timer install + token rotation"
```

---

## Final verification

After every task is complete, run a full pass.

- [ ] **Run all tests**

```bash
bun test
```

Expected: every test in `src/lib/**`, `src/app/dashboard/**`, etc. passes.

- [ ] **Typecheck the build**

```bash
bun x tsc --noEmit && bun run build
```

Expected: clean build.

- [ ] **Lint**

```bash
bun run lint
```

Expected: no errors.

- [ ] **End-to-end smoke**

`bun dev`. Verify:
1. Dashboard default load: management sees today→today+30; EPO sees today-7→today+30. No regression vs. pre-feature behavior.
2. Pick a 1-week past range via the calendar picker. Cards render from snapshots (or `?` placeholders for dates with no live row). Editing controls absent on management's past cards.
3. Pick a range spanning past + future. Past from snapshots, future from live, sorted by date.
4. Manual snapshot run:
   ```bash
   curl -fsS -X POST http://localhost:3000/api/snapshot/run -H "Authorization: Bearer $SNAPSHOT_CRON_TOKEN"
   ```
   Returns JSON with `snapshotted` / `unrecoverable` / `alreadyFrozen`.
5. Past dates that didn't have a snapshot but do have a live sheet row — load the dashboard with that date in the range and confirm a `frozen_by='lazy'` row appears in `card_snapshots`.
6. The "All Dates / Unassigned / This Week / Next Week" pill filters still work as expected within the picked range.

If any verification fails, fix and re-test before declaring the feature complete.
