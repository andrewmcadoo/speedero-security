# Teak Airline Legs — EPO Travel Details Card

**Date:** 2026-04-13
**Status:** Design approved, ready for implementation plan

## Summary

On the EPO dashboard, each assigned date currently shows a `ScheduleDetailCard`. For dates that have a corresponding row on the source spreadsheet's **Teak Airline Legs** sheet, add a collapsible "Travel Details" section inside that card. The section is EPO-only and only appears for dates the viewing EPO is assigned to.

## Source Sheet

- **Sheet name:** `Teak Airline Legs`
- **Header:** 1 row (appears multi-line in the CSV due to quoted newlines inside cells — logically one row)
- **Columns (A–H):**

  | Idx | Column | Notes |
  |-----|--------|-------|
  | 0 | Date | Format `DD-MMM` (e.g. `27-Mar`) — note: **opposite token order** from the main sheet's `Mar-27` |
  | 1 | Pick up or Drop off | Dirty values observed: `Pick up`, `Pickup`, `Pickip`, `Drop off`, `Drop Off`, em-dash, blank |
  | 2 | Location | Free text |
  | 3 | Time | Free text — occasionally contains non-time values (e.g. row for `1-Apr` has `BH Airbnb` in the Time column — display as-is) |
  | 4 | Companion | Free text, trailing whitespace observed (`Hayk `) |
  | 5 | Companion Pre Position Flight | Free text flight e.g. `AS562 BUR-PDX 7:00-9:31`; `—` or blank when none |
  | 6 | Teak Flight | Free text flight; `—` or blank when none |
  | 7 | Companion Return Flight | Free text flight; `—` or blank when none |

- **Row conventions:**
  - Blank separator rows (all cells empty) appear between groups — skip any row with empty date column.
  - Literal em-dash `—` in a cell means "none" (equivalent to blank for display purposes).

## Visibility

A travel-details row is attached to a `DashboardEntry` only when **both**:

1. The viewing user's role is `"epo"`, **and**
2. The viewing user is assigned to that date.

Otherwise `travelLeg` is undefined. The UI component renders only when `entry.travelLeg` is present, so no role logic lives in the component. Management dashboard is untouched.

## Data Layer

### New type — `src/types/schedule.ts`

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

export interface DashboardEntry extends ScheduleEntry {
  // ...existing fields...
  travelLeg?: TravelLeg;
}
```

Raw string values (including literal `—`) are preserved in the type — em-dash-vs-blank normalization is a render-time decision.

### Fetch — `src/lib/google-sheets.ts`

Replace the existing `spreadsheets.get` call in `fetchSchedule()` with a single `spreadsheets.values.batchGet` covering **both** ranges:

- `Master!A:T` (or whatever the current main sheet name is — the existing code uses `A:T` on sheet index 0; preserve that behavior, just move to `batchGet` with an explicit sheet title)
- `Teak Airline Legs!A:H`

Export a new `fetchTravelLegs(): Promise<Map<string, TravelLeg>>` — or fold both into a combined fetcher. Preferred shape: keep `fetchSchedule()` as today but have it return travel legs alongside entries, since callers already fetch the whole schedule.

**Note:** The main sheet currently uses `spreadsheets.get` with `includeGridData: true` to read background colors (for green/yellow confirmation status). That call must stay as-is. Teak Airline Legs has no color-based semantics, so its data can come from the cheaper `values.batchGet`. The "one round trip" goal therefore means: **parallel** `spreadsheets.get` (main, with grid data) + `values.batchGet` (teak legs) via `Promise.all`, not a single combined call. This is a clarification of the earlier design note.

### Date parser — new `parseTeakDate`

Mirror of the existing `parseSheetDate` but with inverted tokens:

- Accepts `DD-MMM` (e.g. `27-Mar`, `1-Apr`).
- Same "more than 6 months in the past → bump to next year" inference rule as `parseSheetDate`.
- Returns ISO `YYYY-MM-DD` or `null` for empty/malformed.

### Row → `TravelLeg` mapper

For each row where `parseTeakDate(row[0])` returns a date:

- Trim all string fields.
- Normalize action (column 1):
  - `pick up`, `pickup`, `pickip` (case-insensitive) → `"Pick up"`
  - `drop off`, `drop off`, `dropoff` (case-insensitive) → `"Drop off"`
  - Empty / `—` / anything else → `"Unknown"`
- Preserve all other fields verbatim (after trim).
- Build `Map<date, TravelLeg>` keyed by ISO date for O(1) join.

### Server wiring

Wherever `DashboardEntry[]` is assembled for the EPO view (dashboard page loader / `src/lib/supabase/queries.ts`), after the existing work:

```ts
if (user.role === "epo") {
  for (const entry of entries) {
    if (assignedDates.has(entry.date)) {
      entry.travelLeg = travelLegsByDate.get(entry.date);
    }
  }
}
```

Management assembly is unchanged.

## UI

### New component — `src/components/travel-details-section.tsx`

Rendered inside `ScheduleDetailCard` **only when** `entry.travelLeg` is defined. Placed at the bottom of the card, separated by a top border.

Uses native `<details>` / `<summary>`:

- Collapsed by default.
- Summary row: `Travel Details` with a chevron that rotates on open via CSS.
- No client JS / React state required.

If the codebase already has a house collapsible pattern (e.g. in `ScheduleDetailCard` or elsewhere), adopt that instead during implementation.

### Expanded content — 2-column label/value list

Rows, in order:

| Label | Value source |
|-------|--------------|
| Action | `travelLeg.action`; render `"Unknown"` as `—` |
| Location | `travelLeg.location` |
| Time | `travelLeg.time` |
| Companion Pre-Position | `travelLeg.companionPrePositionFlight` |
| Teak Flight | `travelLeg.teakFlight` |
| Companion Return | `travelLeg.companionReturnFlight` |

(The `companion` field is intentionally **not rendered** — the EPO viewing the card is the companion, so showing their own name is noise. The field is still parsed/stored for future use.)

**Render rules:**

- Empty string → `—`
- Literal `—` passes through unchanged (same visual).
- Labels muted, values normal-weight — reuse `ScheduleDetailCard`'s existing label/value Tailwind classes.
- Labels have a fixed min-width so values align on mobile.

## Edge Cases

| Case | Behavior |
|------|----------|
| No Teak Airline Legs row for date | `travelLeg` undefined → section not rendered |
| Row exists, all flight fields blank | Section renders; flight rows show `—` |
| Row exists, action/location/time blank (e.g. `8-Jun`, `14-Jun`) | Those rows show `—`; flight rows show their values |
| Action typo / variant (`Pickip`, `Pickup`, `Drop Off`) | Normalized to canonical value |
| Trailing whitespace on any field | Trimmed at parse time |
| `Time` cell contains non-time text | Displayed as-is — not our job to validate source data |
| Management user on any date | No travelLeg attached; nothing renders |
| EPO viewing unassigned date | No travelLeg attached; nothing renders |

## Testing

- Unit: `parseTeakDate` — valid formats (`27-Mar`, `1-Apr`), empty, malformed, year-inference boundary.
- Unit: row-to-`TravelLeg` mapper — representative dirty rows from the source CSV (`Pickip`, trailing-space names, em-dash fields, all-blank-flights, time-field-contains-location).
- Unit: `travelLegsByDate` construction — skips separator rows, produces expected map size against a fixture slice of the real CSV.
- Visual: render `EpoDashboard` with a fixture containing one entry with `travelLeg` and one without; confirm collapsed-by-default, expand interaction, and alignment.

## Out of Scope

- No edit UI for travel legs (read-only from the sheet, matching the existing schedule).
- No caching/revalidation changes — travel-leg fetch follows whatever strategy the main schedule fetch already uses.
- No notifications or change-alerts when travel details change.
- No companion-facing view (only the assigned EPO sees their own legs).
