# Security Assignment Scheduler — Design Spec

## Problem

Security management currently maintains two spreadsheets: a master travel calendar (Google Sheet) and a second sheet where schedule details are copy-pasted and EPO (Executive Protection Officer) assignments are added. This manual process is error-prone and doesn't give EPOs direct access to their assignment details.

## Solution

A web app that:
1. Reads schedule data live from the master Google Sheet (source of truth)
2. Lets management assign EPOs to dates and set staffing requirements
3. Gives each EPO a personalized, read-only view of their assignments

This eliminates the second spreadsheet entirely.

## Architecture

### Tech Stack

- **Frontend/Backend:** Next.js (App Router)
- **Database/Auth:** Supabase (PostgreSQL + Google SSO + RLS)
- **Data Source:** Google Sheets API v4 (service account, read-only)
- **Deployment:** TBD (Vercel recommended)

### Data Flow

```
Master Google Sheet
        │
        ▼ (Google Sheets API v4, read-only)
   Next.js API Route (cached, revalidate ~60s)
        │
        ├── Schedule data: dates, activities, locations,
        │   confirmations, flights, lodging, transitions,
        │   ground transport, comments
        │
        ▼
   Next.js Frontend ◄──── Supabase DB
        │                     │
        │                     ├── assignments (EPO ↔ date)
        │                     ├── date_settings (min detail)
        │                     └── profiles (users + roles)
        │
        ├── EPO View: filtered to their assignments, core fields only
        └── Management View: all dates, full logistics, assignment controls
```

### Google Sheets Integration

- Service account with read-only access to the master sheet
- Next.js API route `/api/schedule` fetches and normalizes sheet data
- Cached via Next.js ISR (`revalidate: 60`) — data is at most 60 seconds stale
- Rows are keyed by date for joining with Supabase assignment data
- The `ROW_ID` column (UUID) in the sheet can serve as a stable row identifier
- **Date parsing:** Sheet dates use "Mar-27" format (abbreviated month + day, no year, possible trailing spaces). The app infers the year from context (current year, or next year if the date has passed). Dates are normalized to ISO format (`2026-03-27`) for storage and matching.
- **Confirmation status:** The "Confirmed" column may be empty, contain a checkmark, or text. The app treats non-empty as "confirmed", empty as "unconfirmed". If this needs more granularity (e.g., "pending"), management can clarify the conventions used in the sheet.

### Column Mapping from Master Sheet

| Sheet Column | App Field | Shown To |
|---|---|---|
| Date | `date` | All |
| Confirmed | `confirmation_status` | All |
| Activity | `activity` | All |
| Night Location | `location` | All |
| Teak Transitions | `transitions` | Management |
| Co-Pilot | `co_pilot` | Management |
| Airline Flt/Arrival Time | `flight_info` | Management |
| Departure (Airport, FBO, Time) | `departure` | Management |
| Arrival (Airport, FBO, Time) | `arrival` | Management |
| International Pax | `international_pax` | Management |
| Ground Transport | `ground_transport` | Management |
| Lodging | `lodging` | Management |
| Comments | `comments` | Management |
| ROW_ID | `row_id` | Internal |

## Data Model (Supabase)

### `profiles`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | Supabase auth user ID |
| `email` | text | From Google SSO |
| `full_name` | text | From Google SSO |
| `role` | enum (`epo`, `management`) | Default: `epo` |
| `created_at` | timestamptz | Auto |

### `assignments`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | Auto-generated |
| `date` | date | Matches schedule date |
| `row_id` | uuid | Optional — matches sheet ROW_ID for stability |
| `epo_id` | uuid (FK → profiles) | Assigned EPO |
| `assigned_by` | uuid (FK → profiles) | Who made the assignment |
| `created_at` | timestamptz | Auto |

Unique constraint on `(date, epo_id)` — an EPO can only be assigned once per date.

### `date_settings`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | Auto-generated |
| `date` | date (unique) | One settings row per date |
| `min_detail_required` | integer | Minimum EPOs needed |
| `updated_by` | uuid (FK → profiles) | Last editor |
| `updated_at` | timestamptz | Auto |

## Authentication & Authorization

### Auth Flow

1. User navigates to app → redirected to `/login`
2. Clicks "Sign in with Google" → Supabase Auth handles OAuth
3. On first login, a trigger creates a `profiles` row with `role: epo`
4. Management promotes users via `/admin/users`

### Row-Level Security (RLS)

| Table | EPO | Management |
|---|---|---|
| `profiles` | Read own | Read/write all |
| `assignments` | Read own (where `epo_id = auth.uid()`) | Read/write all |
| `date_settings` | Read all | Read/write all |

## UI Design

### EPO Dashboard (read-only)

- **Layout:** Scrollable card list grouped by date
- **Time range:** Rolling window (past 7 days + next 30 days). Hardcoded default; can be adjusted in code if needed later.
- **Each card shows:**
  - Date with day-of-week
  - Confirmation status (color-coded: green=confirmed, yellow=pending, gray=unconfirmed)
  - Activity name
  - Location
  - Minimum security detail required

### Management Dashboard (read/write)

Same card list layout, plus:

- **Expanded cards** show full logistics (transitions, lodging, flights, ground transport, comments)
- **EPO assignment:** Tag chips per date with "+ Assign" button (dropdown of available EPOs)
- **Minimum detail:** Editable counter (+/-) per date
- **Coverage indicators:** EPOs assigned vs. minimum detail (red = none assigned, yellow = under-staffed, green = met)
- **Filters:** All dates, Unassigned only, This Week, Next Week
- **Search:** Filter by activity name or location

### Admin: User Management (`/admin/users`)

- List of all users with name, email, role
- Toggle role between `epo` and `management`
- Management-only access

## Pages / Routes

| Route | Access | Purpose |
|---|---|---|
| `/` | All | Redirect to `/dashboard` |
| `/login` | Public | Google SSO login page |
| `/dashboard` | Authenticated | EPO or Management view (role-based) |
| `/admin/users` | Management | User role management |

## Key Decisions

1. **Google Sheet stays canonical** — the app never writes to it. Schedule changes happen in the sheet and propagate to the app within ~60 seconds.
2. **App owns assignments** — EPO-to-date mappings and minimum detail requirements live in Supabase, not the sheet.
3. **Direct API over sync** — simpler architecture, acceptable latency for small team, no duplicate data to maintain.
4. **Single dashboard route** — role determines what you see, not where you go.

## Out of Scope (for now)

- Push notifications when assignments change
- Mobile native app (responsive web is sufficient)
- Editing the Google Sheet from within the app
- Historical reporting or analytics
- Multi-sheet or multi-calendar support
