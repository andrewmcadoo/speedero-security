# Teak Pick-Up/Drop-Off — Manager Input

**Date:** 2026-04-15
**Status:** Design approved, ready for implementation plan
**Supersedes:** `2026-04-13-teak-airline-legs-design.md` (Google Sheets–based approach)

## Summary

Replace the Google Sheets–sourced Teak Pick-Up/Drop-Off data with a Supabase-backed system where managers enter travel leg details directly from the admin dashboard. Each date can be toggled as a Teak PU/DO day with an inline form for the remaining fields. EPO read-only view is unchanged.

## Database

### New table: `travel_legs`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `date` | `date` | UNIQUE, NOT NULL |
| `action` | `text` | NOT NULL, CHECK `action IN ('Pick up', 'Drop off')` |
| `location` | `text` | NOT NULL, default `''` |
| `time` | `text` | NOT NULL, default `''` |
| `companion` | `text` | NOT NULL, default `''` |
| `companion_pre_position_flight` | `text` | NOT NULL, default `''` |
| `teak_flight` | `text` | NOT NULL, default `''` |
| `companion_return_flight` | `text` | NOT NULL, default `''` |
| `created_by` | `uuid` | FK → `profiles.id`, NOT NULL |
| `updated_at` | `timestamptz` | NOT NULL, default `now()` |

### RLS policies

- **Management:** full CRUD (INSERT, SELECT, UPDATE, DELETE) where `profiles.role = 'management'`
- **EPO:** SELECT only — further filtered server-side to dates the EPO is assigned to

## UI — Admin Dashboard Card

### Toggle area

Located below the existing EPO assignment section in each admin card's expanded view. A row with label "TEAK" and two small buttons side by side:

- **Pick Up** — green tint (matches existing green PICK UP badge style)
- **Drop Off** — rose tint (matches existing rose DROP OFF badge style)

Both appear muted/outlined when inactive.

**Activation flow:**
1. Manager clicks "Pick Up" or "Drop Off"
2. Creates a `travel_legs` row with that action and the entry's date
3. Clicked button becomes solid/active; the other stays muted
4. Corresponding badge (PICK UP or DROP OFF) appears in the collapsed card header
5. A collapsible form section expands below with the six remaining fields

**Switching action:** Clicking the inactive button while the other is active updates the existing row's `action` column. Badge color and text change accordingly.

**Deactivation:** Clicking the already-active button deletes the `travel_legs` row, removes the badge from the header, and collapses the form.

### Inline form

Six text input fields, single-column layout, appearing below the toggle when active:

1. Location
2. Time
3. Companion
4. Companion Pre-Position Flight
5. Teak Flight
6. Companion Return Flight

**Save behavior:** Each field saves on blur — individual update to Supabase for that column. No submit button. `updated_at` is refreshed on each save.

### Card header badges

Same visual treatment as today:
- **PICK UP** — green badge (`bg-green-900/60 text-green-300`)
- **DROP OFF** — rose badge (`bg-rose-900/60 text-rose-300`)

Badges appear in both collapsed and expanded card header, driven by the existence and action of a `travel_legs` row for that date.

## EPO Dashboard (read side)

No changes to `TravelDetailsSection` component. It still renders the same collapsible read-only detail view with the seven label/value rows. The only change is the data source: the server query reads from the `travel_legs` table instead of Google Sheets.

## Data flow

### Admin (write path)
1. Admin dashboard page loads → fetch `travel_legs` rows for visible date range from Supabase
2. Manager clicks toggle → INSERT/UPDATE/DELETE on `travel_legs` table
3. Manager edits field, blurs → UPDATE single column on `travel_legs` row
4. UI updates optimistically

### EPO (read path)
1. EPO dashboard page loads → server fetches `travel_legs` rows for assigned dates
2. Joins travel leg to `DashboardEntry.travelLeg` (same shape as today)
3. `TravelDetailsSection` renders if `travelLeg` is present

## Code changes

### Delete
- `src/lib/teak-airline-legs.ts` — sheet row parser, no longer needed
- `src/lib/teak-airline-legs.test.ts` — associated tests

### Modify
- `src/lib/google-sheets.ts` — remove `Teak Airline Legs` batchGet call and travel leg joining logic
- `src/app/dashboard/page.tsx` — fetch travel legs from Supabase instead of sheets; attach to `DashboardEntry` as before
- `src/components/schedule-detail-card.tsx` — add `TeakToggle` in expanded view for management role; conditionally render based on user role
- `src/types/schedule.ts` — `TravelLeg` interface stays the same (no changes needed)

### Create
- Supabase migration — `travel_legs` table, RLS policies
- `src/components/teak-toggle.tsx` — Pick Up / Drop Off toggle buttons + inline form for admin cards

### Unchanged
- `src/components/travel-details-section.tsx` — read-only EPO view, no changes

## Edge cases

| Case | Behavior |
|------|----------|
| Manager toggles Pick Up, then switches to Drop Off | Updates existing row's `action`, badge changes |
| Manager deactivates toggle | Row deleted, badge removed, form collapses |
| Two managers edit same date concurrently | Last write wins (matches assignments/date-settings behavior) |
| EPO views date with no travel leg row | No section rendered (unchanged) |
| Manager leaves form fields empty | Stored as empty strings; EPO sees `—` (existing render logic in `TravelDetailsSection`) |
| Date has travel leg but no EPO assigned | Badge shows on admin card; EPO dashboard unaffected |

## Out of scope

- No migration of existing Google Sheets data (clean break — managers re-enter as needed)
- No history/audit log of travel leg changes
- No bulk entry UI (one date at a time via admin card)
- No notifications when travel details are created or changed
