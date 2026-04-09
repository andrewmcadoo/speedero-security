# Admin Dashboard: Editable Cells with Google Sheets Sync

## Summary

Redesign the management dashboard's expanded card view so all schedule fields are inline-editable inputs. Edits are tracked across multiple cards and batch-saved back to Google Sheets via a persistent floating toolbar.

## Current State

- Management dashboard (`/dashboard`) shows a vertical list of expandable cards per day
- Cards expand to show read-only schedule fields (activity, location, transitions, lodging, flight info, etc.)
- EPO assignments and detail counter are already interactive
- Schedule data is fetched read-only from Google Sheets via `fetchSchedule()` in `src/lib/google-sheets.ts`
- The `COL` map (column indices) and `HEADER_ROWS = 2` constant already exist

## Design

### 1. Editable Card Fields

When a `ManagementCard` is expanded, schedule fields render as controlled inputs instead of static text.

**Field → Input mapping:**

| Field | Input Type |
|-------|-----------|
| activity | `<input type="text">` |
| location | `<input type="text">` |
| coPilot | `<input type="text">` |
| lodging | `<input type="text">` |
| flightInfo | `<input type="text">` |
| internationalPax | `<input type="text">` |
| transitions | `<textarea>` |
| comments | `<textarea>` |
| groundTransport | `<textarea>` |
| departure.airport | `<input type="text">` |
| departure.fbo | `<input type="text">` |
| departure.time | `<input type="text">` |
| arrival.airport | `<input type="text">` |
| arrival.fbo | `<input type="text">` |
| arrival.time | `<input type="text">` |
| confirmationStatus | `<select>` (confirmed / pending / unconfirmed) |
| teakNight | `<input type="checkbox">` |

**Not editable in this view** (unchanged):
- Date, day of week (derived from sheet structure)
- EPO assignments (existing `EpoAssignment` component)
- Detail counter (existing `DetailCounter` component)

### 2. Dirty State Tracking & Batch Save

**State management** — a `useScheduleEdits` hook at the `ManagementDashboard` level:

```ts
type EditMap = Record<string, Partial<ScheduleEntry>>; // keyed by rowId

interface UseScheduleEdits {
  edits: EditMap;
  updateField: (rowId: string, field: string, value: string | boolean) => void;
  discardAll: () => void;
  discardEntry: (rowId: string) => void;
  hasPendingEdits: boolean;
  pendingCount: number;
}
```

- `ManagementDashboard` passes `edits` + `updateField` down to each `ManagementCard`
- Cards merge `edits[entry.rowId]` over the original `entry` to show current values
- Cards with edits get a subtle visual indicator (e.g., small blue dot on the date header)

**Floating save bar** — a sticky bottom bar, visible only when `hasPendingEdits` is true:

- Shows: "{n} dates modified"
- Two buttons: "Save All" (primary) and "Discard" (secondary/destructive)
- "Save All" triggers the batch write server action
- "Discard" clears all pending edits (with a confirmation if > 1 edit)

### 3. Google Sheets Write Path

**Auth scope change** — in `getAuth()`, change scope from `spreadsheets.readonly` to `spreadsheets`.

**New function in `src/lib/google-sheets.ts`:**

```ts
export async function updateScheduleEntries(
  edits: { rowId: string; fields: Partial<ScheduleEntry> }[]
): Promise<void>
```

**Row resolution** — to map `rowId` → sheet row number:
1. Fetch column T (ROW_ID column) values
2. Find the row index for each `rowId`
3. Sheet row number = data index + HEADER_ROWS + 1 (1-indexed)

**Column resolution** — reuse the existing `COL` map to convert field names to column indices, then to A1 notation (column index → letter).

**Batch update** — use `spreadsheets.values.batchUpdate` with `ValueInputOption: 'USER_ENTERED'` to write all changed cells in a single API call.

**Server action** — a Next.js server action in a new file (e.g., `src/app/dashboard/actions.ts`):
- Accepts the edits array
- Calls `updateScheduleEntries`
- Calls `revalidatePath('/dashboard')` to refresh server data
- Returns success/error

**Conflict handling** — none for now. The app is the primary editor. If someone edits the sheet directly while the app has unsaved changes, the app's save will overwrite those cells.

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/google-sheets.ts` | Add `updateScheduleEntries()`, change auth scope to read/write |
| `src/components/management-card.tsx` | Replace static text with controlled inputs, accept edit props |
| `src/app/dashboard/management-dashboard.tsx` | Add `useScheduleEdits` hook, floating save bar, pass edit state to cards |
| `src/app/dashboard/actions.ts` | **New file** — server action for batch save |

## Files NOT Modified

- `src/types/schedule.ts` — existing types are sufficient
- `src/app/dashboard/page.tsx` — server component stays the same
- `src/components/epo-assignment.tsx` — unchanged
- `src/components/detail-counter.tsx` — unchanged
- `src/app/admin/users/page.tsx` — out of scope

## Edge Cases

- **Empty fields** — empty string is a valid value (clears the cell in Sheets)
- **No edits** — save bar doesn't appear, nothing to send
- **Save failure** — show error toast/message, keep edits in state so user can retry
- **Navigation with unsaved changes** — use `beforeunload` event to warn

## Out of Scope

- Undo/redo per field
- Real-time collaboration / conflict detection
- Adding or deleting rows (days) from the sheet
- Mobile-optimized editing
