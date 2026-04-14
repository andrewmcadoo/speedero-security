# Teak Airline Legs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible "Travel Details" section inside the EPO dashboard's schedule card, populated from the spreadsheet's `Teak Airline Legs` sheet. Visible only to the assigned EPO on dates that have a row in that sheet.

**Architecture:** Add a second Google Sheets fetch (`values.get` on `Teak Airline Legs!A:H`) that runs in parallel with the existing grid-data fetch. Parse each row into a `TravelLeg`, build a `Map<date, TravelLeg>`, and attach one to each `DashboardEntry` server-side — but only in the EPO branch and only when the date is in `assignedDates`. Render a nested `<details>`/`<summary>` collapsible inside `ScheduleDetailCard`'s existing expanded content.

**Tech Stack:** Next.js 16 (App Router, RSC), TypeScript, `googleapis` SDK, Tailwind v4, Bun (package manager + `bun test` runner).

**Spec:** `docs/superpowers/specs/2026-04-13-teak-airline-legs-design.md`

---

## File Structure

**Create:**
- `src/lib/teak-airline-legs.ts` — pure parsing functions (`parseTeakDate`, `rowToTravelLeg`, `buildTravelLegsMap`). Kept separate from `google-sheets.ts` so the parsing logic can be unit-tested without network/auth.
- `src/lib/teak-airline-legs.test.ts` — bun tests for the parsing functions.
- `src/components/travel-details-section.tsx` — the collapsible card section (server component, no client JS needed).

**Modify:**
- `src/types/schedule.ts` — add `TravelLeg` type and optional `travelLeg` on `DashboardEntry`.
- `src/lib/google-sheets.ts` — add `fetchTravelLegs()` network function delegating to parsers in `teak-airline-legs.ts`.
- `src/app/dashboard/page.tsx` — fetch travel legs in parallel, attach to entries in the EPO branch only.
- `src/components/schedule-detail-card.tsx` — mount `TravelDetailsSection` at the bottom of the expanded panel.
- `package.json` — add a `test` script (`bun test`).

---

## Task 1: Add bun test script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the `test` script**

Replace the `scripts` block in `package.json` with:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "bun test"
  },
```

- [ ] **Step 2: Verify test runner works**

Run: `bun test --help`
Expected: prints bun's test CLI help (confirms bun's built-in test runner is available — no install needed).

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add bun test script"
```

---

## Task 2: Add `TravelLeg` type and optional `travelLeg` on `DashboardEntry`

**Files:**
- Modify: `src/types/schedule.ts`

- [ ] **Step 1: Add the type and extend `DashboardEntry`**

Append to `src/types/schedule.ts` (before the final newline — keep existing content intact). Then find the existing `DashboardEntry` interface and add the `travelLeg?` field.

Add at the bottom of the file:

```ts
export interface TravelLeg {
  date: string; // ISO YYYY-MM-DD
  action: "Pick up" | "Drop off" | "Unknown";
  location: string;
  time: string;
  companion: string;
  companionPrePositionFlight: string;
  teakFlight: string;
  companionReturnFlight: string;
}
```

Modify the existing `DashboardEntry` interface (currently at the end of the file) to include the new optional field:

```ts
export interface DashboardEntry extends ScheduleEntry {
  detailLevel: DetailLevel;
  assignedEpos: Pick<Profile, "id" | "fullName" | "email">[];
  isPast?: boolean;
  isThisWeek?: boolean;
  isNextWeek?: boolean;
  travelLeg?: TravelLeg;
}
```

- [ ] **Step 2: Type-check the project**

Run: `bunx tsc --noEmit`
Expected: no new errors (the optional field is additive).

- [ ] **Step 3: Commit**

```bash
git add src/types/schedule.ts
git commit -m "types: add TravelLeg and optional travelLeg on DashboardEntry"
```

---

## Task 3: `parseTeakDate` — date parser (TDD)

**Files:**
- Create: `src/lib/teak-airline-legs.ts`
- Test: `src/lib/teak-airline-legs.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/teak-airline-legs.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { parseTeakDate } from "./teak-airline-legs";

describe("parseTeakDate", () => {
  test("parses DD-MMM format with zero-padded output", () => {
    // Reference "now" is inferred by the runtime; we test stable shape,
    // not year inference, to keep the test deterministic across dates.
    const result = parseTeakDate("27-Mar");
    expect(result).toMatch(/^\d{4}-03-27$/);
  });

  test("parses single-digit day", () => {
    const result = parseTeakDate("1-Apr");
    expect(result).toMatch(/^\d{4}-04-01$/);
  });

  test("case-insensitive month abbreviation", () => {
    expect(parseTeakDate("5-JUN")).toMatch(/^\d{4}-06-05$/);
    expect(parseTeakDate("5-jun")).toMatch(/^\d{4}-06-05$/);
  });

  test("returns null for empty string", () => {
    expect(parseTeakDate("")).toBeNull();
    expect(parseTeakDate("   ")).toBeNull();
  });

  test("returns null for malformed input", () => {
    expect(parseTeakDate("Mar-27")).toBeNull(); // main-sheet format, wrong for this sheet
    expect(parseTeakDate("27/03")).toBeNull();
    expect(parseTeakDate("March 27")).toBeNull();
    expect(parseTeakDate("27-Foo")).toBeNull();
  });

  test("bumps year when date is more than 6 months in the past", () => {
    // Jan 1 2026 as reference → July 2025 is >6mo back → should bump to 2026
    const refDate = new Date(2026, 0, 1);
    expect(parseTeakDate("15-Jul", refDate)).toBe("2026-07-15");
    // Jan 1 2026 as reference → Oct 2025 is <6mo back → keep 2025 year
    expect(parseTeakDate("15-Oct", refDate)).toBe("2025-10-15");
  });
});
```

- [ ] **Step 2: Create the source file as an empty export so the test fails on "not defined"**

Create `src/lib/teak-airline-legs.ts`:

```ts
export {};
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test src/lib/teak-airline-legs.test.ts`
Expected: FAIL — `parseTeakDate is not a function` (or similar import-binding error).

- [ ] **Step 4: Implement `parseTeakDate`**

Replace `src/lib/teak-airline-legs.ts` with:

```ts
const MONTH_NAMES: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parse "27-Mar" / "1-Apr" style dates into ISO (YYYY-MM-DD).
 * Mirrors google-sheets.ts#parseSheetDate but with inverted tokens
 * (DD-MMM instead of MMM-DD).
 *
 * Year inference: uses `now`'s year; if the resulting date is more than
 * 6 months in the past, bumps forward one year. Pass `now` explicitly
 * for deterministic tests.
 */
export function parseTeakDate(
  raw: string,
  now: Date = new Date()
): string | null {
  const cleaned = raw.trim();
  if (!cleaned) return null;

  const match = cleaned.match(/^(\d{1,2})-([A-Za-z]{3})$/);
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const month = MONTH_NAMES[match[2].toLowerCase()];
  if (month === undefined) return null;
  if (day < 1 || day > 31) return null;

  let year = now.getFullYear();
  const candidate = new Date(year, month, day);
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  if (candidate < sixMonthsAgo) year++;

  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/lib/teak-airline-legs.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/teak-airline-legs.ts src/lib/teak-airline-legs.test.ts
git commit -m "feat: parseTeakDate for DD-MMM format with year inference"
```

---

## Task 4: `rowToTravelLeg` — row mapper (TDD)

**Files:**
- Modify: `src/lib/teak-airline-legs.ts`
- Modify: `src/lib/teak-airline-legs.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/teak-airline-legs.test.ts`:

```ts
import { rowToTravelLeg } from "./teak-airline-legs";

describe("rowToTravelLeg", () => {
  const refDate = new Date(2026, 3, 1); // 2026-04-01

  test("maps a clean row into a TravelLeg", () => {
    const row = [
      "27-Mar",
      "Pick up",
      "L.O.",
      "14:45",
      "Hayk",
      "AS562 BUR-PDX 7:00-9:31",
      "AS559 PDX-BUR 17:57-20:19",
      "—",
    ];
    expect(rowToTravelLeg(row, refDate)).toEqual({
      date: "2026-03-27",
      action: "Pick up",
      location: "L.O.",
      time: "14:45",
      companion: "Hayk",
      companionPrePositionFlight: "AS562 BUR-PDX 7:00-9:31",
      teakFlight: "AS559 PDX-BUR 17:57-20:19",
      companionReturnFlight: "—",
    });
  });

  test("returns null when date column is empty (separator row)", () => {
    const row = ["", "", "", "", "", "", "", ""];
    expect(rowToTravelLeg(row, refDate)).toBeNull();
  });

  test("returns null when date is malformed", () => {
    const row = ["not-a-date", "Pick up", "L.O.", "", "", "", "", ""];
    expect(rowToTravelLeg(row, refDate)).toBeNull();
  });

  test("normalizes action variants and typos", () => {
    const makeRow = (action: string) =>
      ["9-Mar", action, "L.O.", "14:45", "Hayk", "", "", ""];
    expect(rowToTravelLeg(makeRow("Pick up"), refDate)?.action).toBe("Pick up");
    expect(rowToTravelLeg(makeRow("Pickup"), refDate)?.action).toBe("Pick up");
    expect(rowToTravelLeg(makeRow("Pickip"), refDate)?.action).toBe("Pick up"); // typo in source
    expect(rowToTravelLeg(makeRow("Drop off"), refDate)?.action).toBe("Drop off");
    expect(rowToTravelLeg(makeRow("Drop Off"), refDate)?.action).toBe("Drop off");
    expect(rowToTravelLeg(makeRow(""), refDate)?.action).toBe("Unknown");
    expect(rowToTravelLeg(makeRow("—"), refDate)?.action).toBe("Unknown");
    expect(rowToTravelLeg(makeRow("weird"), refDate)?.action).toBe("Unknown");
  });

  test("trims trailing whitespace on all string fields", () => {
    const row = [
      "16-Jan",
      "Pickup",
      "L.O. ",
      "14:45",
      "Hayk ",
      "",
      "AS559 PDX-BUR 17:55-20:09",
      "",
    ];
    const leg = rowToTravelLeg(row, refDate);
    expect(leg?.location).toBe("L.O.");
    expect(leg?.companion).toBe("Hayk");
    expect(leg?.teakFlight).toBe("AS559 PDX-BUR 17:55-20:09");
  });

  test("preserves blank (empty string) fields as-is — no em-dash coercion", () => {
    const row = ["14-Jun", "", "", "", "", "AS 1397 LAX-PDX 6:07-8:30pm", "", ""];
    const leg = rowToTravelLeg(row, refDate);
    expect(leg?.action).toBe("Unknown");
    expect(leg?.location).toBe("");
    expect(leg?.time).toBe("");
    expect(leg?.companionPrePositionFlight).toBe("AS 1397 LAX-PDX 6:07-8:30pm");
    expect(leg?.teakFlight).toBe("");
    expect(leg?.companionReturnFlight).toBe("");
  });

  test("handles short rows (missing trailing cells) gracefully", () => {
    const row = ["9-Mar", "Pick up", "L.O.", "14:45"]; // only 4 cells
    const leg = rowToTravelLeg(row, refDate);
    expect(leg).not.toBeNull();
    expect(leg?.companion).toBe("");
    expect(leg?.teakFlight).toBe("");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/lib/teak-airline-legs.test.ts`
Expected: FAIL — `rowToTravelLeg is not a function`.

- [ ] **Step 3: Implement `rowToTravelLeg`**

Append to `src/lib/teak-airline-legs.ts`:

```ts
import type { TravelLeg } from "@/types/schedule";

function cell(row: readonly string[], idx: number): string {
  return (row[idx] ?? "").trim();
}

function normalizeAction(raw: string): TravelLeg["action"] {
  const lower = raw.trim().toLowerCase();
  if (lower === "pick up" || lower === "pickup" || lower === "pickip") {
    return "Pick up";
  }
  if (lower === "drop off" || lower === "dropoff") {
    return "Drop off";
  }
  return "Unknown";
}

/**
 * Map a single row from the "Teak Airline Legs" sheet into a TravelLeg.
 * Returns null when the date column is empty or malformed (separator rows,
 * trailing empties).
 *
 * Columns (A–H): Date, Action, Location, Time, Companion,
 *   Companion Pre Position Flight, Teak Flight, Companion Return Flight.
 */
export function rowToTravelLeg(
  row: readonly string[],
  now: Date = new Date()
): TravelLeg | null {
  const date = parseTeakDate(cell(row, 0), now);
  if (!date) return null;

  return {
    date,
    action: normalizeAction(cell(row, 1)),
    location: cell(row, 2),
    time: cell(row, 3),
    companion: cell(row, 4),
    companionPrePositionFlight: cell(row, 5),
    teakFlight: cell(row, 6),
    companionReturnFlight: cell(row, 7),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/lib/teak-airline-legs.test.ts`
Expected: PASS — all tests from Tasks 3 & 4 green (13 total).

- [ ] **Step 5: Commit**

```bash
git add src/lib/teak-airline-legs.ts src/lib/teak-airline-legs.test.ts
git commit -m "feat: rowToTravelLeg with action normalization and whitespace trim"
```

---

## Task 5: `buildTravelLegsMap` — assemble the date → leg map (TDD)

**Files:**
- Modify: `src/lib/teak-airline-legs.ts`
- Modify: `src/lib/teak-airline-legs.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/teak-airline-legs.test.ts`:

```ts
import { buildTravelLegsMap } from "./teak-airline-legs";

describe("buildTravelLegsMap", () => {
  const refDate = new Date(2026, 3, 1); // 2026-04-01

  test("skips the header row and separator rows", () => {
    const rows = [
      // Header row
      ["", "Pick up or Drop off", "Location", "Time", "Companion",
        "Companion Pre Position Flight", "Teak Flight", "Companion Return Flight"],
      // Data
      ["27-Mar", "Pick up", "L.O.", "14:45", "Hayk",
        "AS562 BUR-PDX 7:00-9:31", "AS559 PDX-BUR 17:57-20:19", "—"],
      // Separator
      ["", "", "", "", "", "", "", ""],
      // Data
      ["1-Apr", "Pick up", "BH Airbnb", "BH Airbnb", "Hayk",
        "—", "AS1355 LAX-PDX 11:03-13:37", "DL2459 PDX-LAX 19:58-22:34"],
    ];
    const map = buildTravelLegsMap(rows, refDate);
    expect(map.size).toBe(2);
    expect(map.get("2026-03-27")?.action).toBe("Pick up");
    expect(map.get("2026-04-01")?.location).toBe("BH Airbnb");
  });

  test("returns empty map for empty input", () => {
    expect(buildTravelLegsMap([], refDate).size).toBe(0);
  });

  test("later rows with the same date override earlier rows", () => {
    // Spec says one row per day, but be defensive: last-write-wins.
    const rows = [
      ["", "Pick up or Drop off", "Location", "Time", "Companion", "", "", ""],
      ["9-Mar", "Pick up", "Old", "10:00", "Hayk", "", "", ""],
      ["9-Mar", "Drop off", "New", "11:00", "Hayk", "", "", ""],
    ];
    const map = buildTravelLegsMap(rows, refDate);
    expect(map.size).toBe(1);
    expect(map.get("2026-03-09")?.location).toBe("New");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/lib/teak-airline-legs.test.ts`
Expected: FAIL — `buildTravelLegsMap is not a function`.

- [ ] **Step 3: Implement `buildTravelLegsMap`**

Append to `src/lib/teak-airline-legs.ts`:

```ts
/**
 * Build a Map from ISO date → TravelLeg given the raw 2D value grid
 * from `spreadsheets.values.get`. The first row is treated as a header
 * and skipped. Rows with empty/malformed date columns are skipped.
 * If duplicate dates appear, last wins.
 */
export function buildTravelLegsMap(
  rows: readonly (readonly string[])[],
  now: Date = new Date()
): Map<string, TravelLeg> {
  const map = new Map<string, TravelLeg>();
  // Skip header (row 0)
  for (let i = 1; i < rows.length; i++) {
    const leg = rowToTravelLeg(rows[i], now);
    if (leg) map.set(leg.date, leg);
  }
  return map;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/lib/teak-airline-legs.test.ts`
Expected: PASS — all tests green (16 total).

- [ ] **Step 5: Commit**

```bash
git add src/lib/teak-airline-legs.ts src/lib/teak-airline-legs.test.ts
git commit -m "feat: buildTravelLegsMap from raw sheet rows"
```

---

## Task 6: `fetchTravelLegs` — network layer

**Files:**
- Modify: `src/lib/google-sheets.ts`

- [ ] **Step 1: Add the fetcher at the bottom of `google-sheets.ts`**

Append to `src/lib/google-sheets.ts`:

```ts
import { buildTravelLegsMap } from "./teak-airline-legs";
import type { TravelLeg } from "@/types/schedule";

const TEAK_AIRLINE_LEGS_RANGE = "Teak Airline Legs!A:H";

/**
 * Fetch rows from the "Teak Airline Legs" sheet and return a map
 * keyed by ISO date. Returns an empty map on any error (travel details
 * are a non-critical enhancement — dashboard must still render without
 * them).
 */
export async function fetchTravelLegs(): Promise<Map<string, TravelLeg>> {
  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
      range: TEAK_AIRLINE_LEGS_RANGE,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const rows = (response.data.values ?? []) as string[][];
    return buildTravelLegsMap(rows);
  } catch (error) {
    console.error("fetchTravelLegs failed:", error);
    return new Map();
  }
}
```

Note: the existing `fetchSchedule()` stays on `spreadsheets.get` with `includeGridData: true` because it needs background-color parsing. This new function uses the lighter `spreadsheets.values.get` since Teak Airline Legs has no color semantics.

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Lint**

Run: `bun run lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/google-sheets.ts
git commit -m "feat: fetchTravelLegs via values.get on 'Teak Airline Legs!A:H'"
```

---

## Task 7: Wire travelLeg into dashboard page (EPO branch only)

**Files:**
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Update imports**

At the top of `src/app/dashboard/page.tsx`, replace the existing `fetchSchedule` import line:

```ts
import { fetchSchedule, fetchTravelLegs } from "@/lib/google-sheets";
```

- [ ] **Step 2: Fetch travel legs in parallel with schedule, only when we'll use them**

The management branch doesn't use travel legs, so only fetch them for EPO users to save a network call. Change the top-level `Promise.all` block so it only fetches schedule + date settings unconditionally, then fetch travel legs later in the EPO branch.

Currently lines 36–39 read:

```ts
const [schedule, dateSettings] = await Promise.all([
  fetchScheduleData(),
  getDateSettings(supabase),
]);
```

Leave those lines unchanged.

- [ ] **Step 3: In the EPO branch, fetch travel legs in parallel with the assignment queries, and attach**

Currently lines 96–127 (the EPO branch) read:

```ts
const [assignmentsRaw, myAssignments] = await Promise.all([
  getAllAssignmentsWithProfiles(supabase),
  getAssignmentsForUser(supabase, profile.id),
]);

const assignedDates = myAssignments.map((a: { date: string }) => a.date);

// Group all assignments by date (same logic as management)
const assignmentsByDate = new Map<...>();
for (const a of assignmentsRaw) { ... }

const entries: DashboardEntry[] = schedule.map((s) => ({
  ...s,
  detailLevel: settingsMap.get(s.date) ?? "single",
  assignedEpos: assignmentsByDate.get(s.date) ?? [],
  isPast: s.date < today,
  isThisWeek: isThisWeek(s.date),
  isNextWeek: isNextWeek(s.date),
}));
```

Replace the EPO branch (everything after the `// EPO view: ...` comment, through the `return <EpoDashboard ... />` block) with:

```ts
  // EPO view: full schedule with assigned dates info + travel details
  const [assignmentsRaw, myAssignments, travelLegsByDate] = await Promise.all([
    getAllAssignmentsWithProfiles(supabase),
    getAssignmentsForUser(supabase, profile.id),
    fetchTravelLegs(),
  ]);

  const assignedDates = myAssignments.map((a: { date: string }) => a.date);
  const assignedDateSet = new Set(assignedDates);

  // Group all assignments by date (same logic as management)
  const assignmentsByDate = new Map<
    string,
    { id: string; fullName: string; email: string }[]
  >();
  for (const a of assignmentsRaw) {
    const epoInfo = a.profiles as { id: string; full_name: string; email: string } | null;
    if (!epoInfo) continue;
    const existing = assignmentsByDate.get(a.date) ?? [];
    existing.push({
      id: epoInfo.id,
      fullName: epoInfo.full_name,
      email: epoInfo.email,
    });
    assignmentsByDate.set(a.date, existing);
  }

  const entries: DashboardEntry[] = schedule.map((s) => ({
    ...s,
    detailLevel: settingsMap.get(s.date) ?? "single",
    assignedEpos: assignmentsByDate.get(s.date) ?? [],
    isPast: s.date < today,
    isThisWeek: isThisWeek(s.date),
    isNextWeek: isNextWeek(s.date),
    // Only attach travelLeg when this EPO is assigned to this date.
    travelLeg: assignedDateSet.has(s.date)
      ? travelLegsByDate.get(s.date)
      : undefined,
  }));

  return (
    <EpoDashboard
      entries={entries}
      assignedDates={assignedDates}
      userName={profile.fullName}
    />
  );
}
```

Management branch is untouched — no `travelLeg` attached there.

- [ ] **Step 4: Type-check**

Run: `bunx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Lint**

Run: `bun run lint`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat: attach travelLeg to EPO dashboard entries for assigned dates"
```

---

## Task 8: `TravelDetailsSection` component

**Files:**
- Create: `src/components/travel-details-section.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/travel-details-section.tsx`:

```tsx
import type { TravelLeg } from "@/types/schedule";

const labelClass = "text-[10px] text-gray-500 mb-0.5";
const valueClass = "text-xs text-gray-100";

function display(value: string): string {
  return value === "" ? "—" : value;
}

function displayAction(action: TravelLeg["action"]): string {
  return action === "Unknown" ? "—" : action;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className={`${labelClass} min-w-[160px] shrink-0 uppercase`}>
        {label}
      </div>
      <div className={valueClass}>{value}</div>
    </div>
  );
}

export function TravelDetailsSection({ leg }: { leg: TravelLeg }) {
  return (
    <details className="group rounded-md border-t border-gray-700/50 bg-gray-950/50 px-2.5 py-2">
      <summary className="flex cursor-pointer list-none items-center justify-between text-[10px] font-medium uppercase text-teal-400">
        <span>Travel Details</span>
        <span className="text-gray-500 transition-transform group-open:rotate-90">
          ▶
        </span>
      </summary>
      <div className="mt-2 space-y-1.5">
        <Row label="Action" value={displayAction(leg.action)} />
        <Row label="Location" value={display(leg.location)} />
        <Row label="Time" value={display(leg.time)} />
        <Row label="Companion" value={display(leg.companion)} />
        <Row label="Companion Pre-Position" value={display(leg.companionPrePositionFlight)} />
        <Row label="Teak Flight" value={display(leg.teakFlight)} />
        <Row label="Companion Return" value={display(leg.companionReturnFlight)} />
      </div>
    </details>
  );
}
```

Notes for the reviewer:
- Server component (no `"use client"`) — native `<details>`/`<summary>` gives us collapse-on-click without JS.
- `group` + `group-open:rotate-90` is a Tailwind v4 pattern that rotates the chevron when `<details open>`.
- Labels are 160px min-width so values align on mobile. This mirrors the rest of the card's small-caps label style.

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/travel-details-section.tsx
git commit -m "feat: TravelDetailsSection collapsible component"
```

---

## Task 9: Mount `TravelDetailsSection` inside `ScheduleDetailCard`

**Files:**
- Modify: `src/components/schedule-detail-card.tsx`

- [ ] **Step 1: Import the new component**

At the top of `src/components/schedule-detail-card.tsx`, after the existing imports, add:

```tsx
import { TravelDetailsSection } from "./travel-details-section";
```

- [ ] **Step 2: Render it at the bottom of the expanded panel**

In the expanded-content block (currently ends around line 143 with the `</div>` closing the assigned-EPOs wrapper), add `TravelDetailsSection` as the last child before the outer `</div>` that closes the expanded panel.

Change the final portion of the expanded block from:

```tsx
          {entry.assignedEpos.length > 0 && (
            <div>
              <div className={labelClass}>ASSIGNED EPOs</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {entry.assignedEpos.map((epo) => {
                  const color = getEpoColor(epo.id);
                  return (
                    <span
                      key={epo.id}
                      className={`rounded px-2 py-0.5 text-xs ${color.bg} ${color.text}`}
                    >
                      {epo.fullName}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

to:

```tsx
          {entry.assignedEpos.length > 0 && (
            <div>
              <div className={labelClass}>ASSIGNED EPOs</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {entry.assignedEpos.map((epo) => {
                  const color = getEpoColor(epo.id);
                  return (
                    <span
                      key={epo.id}
                      className={`rounded px-2 py-0.5 text-xs ${color.bg} ${color.text}`}
                    >
                      {epo.fullName}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {entry.travelLeg && <TravelDetailsSection leg={entry.travelLeg} />}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `bunx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Lint**

Run: `bun run lint`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/schedule-detail-card.tsx
git commit -m "feat: mount TravelDetailsSection in ScheduleDetailCard when travelLeg present"
```

---

## Task 10: Verification

**Files:** none modified.

- [ ] **Step 1: Run all unit tests**

Run: `bun test`
Expected: 16 tests pass (all in `teak-airline-legs.test.ts`).

- [ ] **Step 2: Build**

Run: `bun run build`
Expected: successful build, no type errors.

- [ ] **Step 3: AJ runs `bun run dev` and does a manual visual check** (per CLIPPER.md: "Always let AJ run `bun run dev` and review changes locally before pushing to Clipper")

AJ's checklist:
1. Log in as an EPO assigned to a date that has a Teak Airline Legs row (e.g. an EPO assigned to `2026-03-27` if that's in the seed data).
2. Expand the date's `ScheduleDetailCard`.
3. Confirm "TRAVEL DETAILS" collapsible appears at the bottom of the expanded panel, collapsed by default.
4. Click it; confirm it expands, chevron rotates, and the 7 fields render with proper alignment and em-dashes for blank/—fields.
5. Navigate to a date with **no** Teak Airline Legs row; confirm no Travel Details section appears.
6. Log in as a management user; confirm no Travel Details section appears anywhere, even on dates that have rows.
7. Log in as an EPO **not** assigned to a date that has a row; confirm the section does not appear (defense-in-depth for other-EPO privacy).

- [ ] **Step 4: Report**

Before proceeding, state:
```
VERIFY: Ran `bun test` — Result: PASS (16/16)
VERIFY: Ran `bun run build` — Result: PASS
VERIFY: AJ manual check — Result: [PASS/FAIL with notes]
```

Only mark the plan complete after AJ confirms manual verification.

---

## Notes

- **No server-side caching changes:** travel legs follow whatever caching `fetchSchedule` already uses (currently none explicit — inherits Next.js's default request-time fetching for RSC).
- **Companion privacy:** the visibility rule (EPO-only + assigned-only) is enforced server-side in Task 7; the component has no role logic. A non-assigned EPO's page render will simply not contain any travel-leg data.
- **Empty-map fallback:** `fetchTravelLegs()` returns an empty `Map` on error, so dashboard rendering degrades gracefully if the sheet is missing, misnamed, or the API errors.
- **Header-row tolerance:** `buildTravelLegsMap` always skips row 0. The CSV's header spans multiple visible lines due to quoted newlines in cell values, but it is still one row in the API response.
