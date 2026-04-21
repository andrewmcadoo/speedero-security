# Teak Inline Read-Only View

Date: 2026-04-20
Status: Approved — pending implementation plan

## Problem

In the manager-facing `ManagementCard`, once a `travel_leg` is set for a date and the edit form is closed, the only way to see what was entered is to click the small "Edit" link at the top-right of the TEAK section. Viewing is hidden behind an edit action. Managers should be able to see the saved Teak details inline without entering edit mode.

## Goal

After Pick Up or Drop Off is set and the form has been closed, `TeakToggle` shows an expandable read-only summary of the leg's fields directly in the card, with Edit as a secondary action inside that summary.

## Out of scope

- EPO-facing `schedule-detail-card.tsx` / `TravelDetailsSection` usage is unchanged.
- No changes to the Supabase schema, `travel_legs` table, or server-side data loading.
- No changes to the Pick Up / Drop Off / Teak Night toggle buttons themselves, or to the confirm-dialog flow for unset/switch actions.

## Behavior

### When no leg exists

No change. The TEAK row shows only the three toggle buttons (Pick Up / Drop Off / Teak Night).

### When a leg exists and the form is closed

Below the toggle buttons, `TeakToggle` renders a collapsed-by-default `<details>` panel:

- Summary row reads "Teak Pick Up" or "Teak Drop Off" (matching the existing `TravelDetailsSection` label) with a caret indicator.
- Expanding the panel reveals all six fields in this order: Location, Time, Companion, Companion Pre-Position, Teak Flight, Companion Return.
- Empty fields render as "—" (parity with the EPO-facing `TravelDetailsSection`).
- Inside the expanded panel, below the field rows, an "Edit" button is shown. Clicking it opens the edit form (see below).

The old top-right "Edit" link in the TEAK row header is removed.

### When a leg exists and the form is open

The read-only `<details>` panel is hidden. The existing editable form renders in its place, with one change: alongside the "Save" button, a new "Cancel" button is added.

- **Save** — unchanged. Persists `fields` to Supabase, closes the form on success. Read-only panel reappears collapsed.
- **Cancel** — resets local `fields` state to the last-saved `leg` values (`setFields(toFieldState(leg))`) and sets `formOpen` to `false`. No network call. Read-only panel reappears collapsed. In-progress edits are discarded.

### When the action is toggled (Pick Up ⇄ Drop Off) while the panel is collapsed

Existing confirm-dialog flow is unchanged. After confirmation, the leg's `action` updates, the `<details>` summary text updates accordingly ("Teak Pick Up" ↔ "Teak Drop Off"), and the saved field values persist.

### When the leg is unset (removed)

Existing confirm-dialog flow is unchanged. After confirmation, `leg` becomes `undefined` and the read-only panel disappears.

## Component changes

### `src/components/travel-details-section.tsx`

Add an optional `footer?: React.ReactNode` prop. Render it inside the `<details>` expanded area, below the field rows, inside the existing `mt-2 space-y-1.5` container (or in a sibling container immediately after, with appropriate spacing — implementation detail for the plan).

EPO-side callsite in `schedule-detail-card.tsx` passes no `footer` prop and is otherwise unchanged. The prop is purely additive.

### `src/components/teak-toggle.tsx`

1. Remove the top-right "Edit" link block (currently lines 256–263 within the `mb-1.5 flex items-center justify-between` header row). The header becomes just the "TEAK" label.

2. When `leg && !formOpen`, render:
   ```tsx
   <TravelDetailsSection
     leg={leg}
     footer={
       <button onClick={() => setFormOpen(true)} /* teal text styling */>
         Edit
       </button>
     }
   />
   ```

3. When `leg && formOpen`, render the existing form block with a Cancel button added next to Save. Layout: Save and Cancel side by side, Save primary (current teal style), Cancel secondary (neutral/muted style consistent with the rest of the component).

4. Cancel handler:
   ```ts
   function handleCancel() {
     setFields(toFieldState(leg));
     setFormOpen(false);
   }
   ```
   No Supabase call, no `router.refresh()`.

### No other files change

- `management-card.tsx` is unchanged — it already embeds `<TeakToggle />` and that embed continues to work.
- `schedule-detail-card.tsx` is unchanged.
- No new files. No schema migrations. No new types.

## Data model / persistence

No changes. The read-only view is a pure function of the existing `leg` state already tracked by `TeakToggle`. Cancel operates on local React state only.

## Edge cases

- **Leg exists with all fields empty** (e.g., Pick Up was just toggled on, no fields entered, form closed via external flow): the `<details>` still renders and shows "—" for every field. This is intentional and consistent — it signals "Pick Up is set but no details entered yet."
- **Form is open when parent re-renders with a new `initialLeg`**: existing `useEffect` at lines 95–98 already resets `leg` and `fields` to the new value. Cancel behavior relies on the current `leg` state, so this continues to work correctly. `formOpen` is not reset by that effect — existing behavior preserved.
- **User clicks Edit, edits a field, then toggles Pick Up → Drop Off via the buttons**: existing behavior handles this through `handleToggle` (switch case) which updates `leg.action`. The `fields` are kept. On the next Cancel, `toFieldState(leg)` will restore to the current saved fields, which is correct.
- **Save fails**: existing error handling logs the error and rolls back `leg`. The form stays open (per current behavior). No change to this path.

## Testing

Manual acceptance (end-to-end in the manager dashboard):

1. Start with no leg for a date. Tap **Pick Up**. Form opens. Fill Location + Time. Click **Save**. Verify form closes and a collapsed `<details>` appears reading "Teak Pick Up ▶".
2. Click the `<details>` summary. Verify all six fields are shown — Location and Time show entered values, the other four show "—". Verify an "Edit" button is visible below the fields.
3. Click **Edit**. Verify the read-only panel disappears and the form reappears with Location and Time prefilled.
4. Change Location to a new value. Click **Cancel**. Verify the form closes, the read-only panel reappears collapsed, and expanding it shows the *original* (pre-change) Location — change was discarded.
5. Click **Edit** again. Change Location. Click **Save**. Verify the read-only panel reappears collapsed, and expanding it shows the new Location.
6. Tap **Drop Off** (switch action). Confirm the switch dialog. Verify the `<details>` summary text updates to "Teak Drop Off" and the saved fields persist.
7. Tap **Drop Off** again (unset). Confirm the removal dialog. Verify the `<details>` panel disappears entirely.
8. Repeat step 1 but after Save, collapse the card and re-expand it. Verify the `<details>` is still present and still collapsed by default.

## Migration / rollout

No migrations. Single PR. No feature flag — the change is local to two components and is strictly additive for `TravelDetailsSection`.
