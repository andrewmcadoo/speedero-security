# Teak Pick-Up/Drop-Off Manager Input — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Google Sheets–sourced Teak travel leg data with a Supabase-backed system where managers create/edit/delete travel legs inline on admin dashboard cards.

**Architecture:** New `travel_legs` table in Supabase with RLS. New `TeakToggle` client component (Pick Up / Drop Off buttons + inline form) added to `ManagementCard`. Dashboard page fetches travel legs from Supabase instead of Google Sheets for both management and EPO views. Existing `TravelDetailsSection` (EPO read-only view) is unchanged.

**Tech Stack:** Next.js (App Router), Supabase (Postgres + RLS), TypeScript, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-04-15-teak-manager-input-design.md`

---

### Task 1: Create Supabase migration for `travel_legs` table

**Files:**
- Create: `supabase/migrations/005_travel_legs.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Travel legs: Teak pick-up/drop-off details per date
create table travel_legs (
  id uuid primary key default gen_random_uuid(),
  date date unique not null,
  action text not null check (action in ('Pick up', 'Drop off')),
  location text not null default '',
  time text not null default '',
  companion text not null default '',
  companion_pre_position_flight text not null default '',
  teak_flight text not null default '',
  companion_return_flight text not null default '',
  created_by uuid not null references profiles(id),
  updated_at timestamptz not null default now()
);

create index idx_travel_legs_date on travel_legs(date);

-- RLS
alter table travel_legs enable row level security;

create policy "Authenticated users can read travel legs"
  on travel_legs for select
  using (auth.uid() is not null);

create policy "Management can insert travel legs"
  on travel_legs for insert
  with check (is_management());

create policy "Management can update travel legs"
  on travel_legs for update
  using (is_management());

create policy "Management can delete travel legs"
  on travel_legs for delete
  using (is_management());
```

- [ ] **Step 2: Run the migration in Supabase SQL Editor**

Copy the contents of `supabase/migrations/005_travel_legs.sql` and run in the Supabase SQL Editor. Verify the table appears in the database with the correct columns and RLS policies.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/005_travel_legs.sql
git commit -m "feat: add travel_legs table migration"
```

---

### Task 2: Add Supabase query for travel legs

**Files:**
- Modify: `src/lib/supabase/queries.ts`

- [ ] **Step 1: Add `getTravelLegs` query function**

Add this function at the end of `src/lib/supabase/queries.ts`:

```typescript
export async function getTravelLegs(supabase: SupabaseClient) {
  const { data } = await supabase.from("travel_legs").select("*");
  return data ?? [];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/supabase/queries.ts
git commit -m "feat: add getTravelLegs Supabase query"
```

---

### Task 3: Wire dashboard page to fetch travel legs from Supabase

**Files:**
- Modify: `src/app/dashboard/page.tsx`
- Modify: `src/lib/google-sheets.ts`

- [ ] **Step 1: Update imports in `src/app/dashboard/page.tsx`**

Replace the import of `fetchTravelLegs` from google-sheets with the Supabase query:

```typescript
// OLD:
import { fetchSchedule, fetchTravelLegs } from "@/lib/google-sheets";

// NEW:
import { fetchSchedule } from "@/lib/google-sheets";
```

Add `getTravelLegs` to the existing supabase queries import:

```typescript
// OLD:
import { getProfile, getAssignmentsForUser, getDateSettings, getAllAssignmentsWithProfiles, getAllEpos } from "@/lib/supabase/queries";

// NEW:
import { getProfile, getAssignmentsForUser, getDateSettings, getAllAssignmentsWithProfiles, getAllEpos, getTravelLegs } from "@/lib/supabase/queries";
```

- [ ] **Step 2: Add `TravelLeg` to the type import**

```typescript
// OLD:
import type { ScheduleEntry, DashboardEntry, DetailLevel } from "@/types/schedule";

// NEW:
import type { ScheduleEntry, DashboardEntry, DetailLevel, TravelLeg } from "@/types/schedule";
```

- [ ] **Step 3: Fetch travel legs from Supabase in the management branch**

In the management branch (around line 49), add `getTravelLegs` to the `Promise.all`:

```typescript
// OLD:
const [assignmentsRaw, epos] = await Promise.all([
  getAllAssignmentsWithProfiles(supabase),
  getAllEpos(supabase, profile.id),
]);

// NEW:
const [assignmentsRaw, epos, travelLegsRaw] = await Promise.all([
  getAllAssignmentsWithProfiles(supabase),
  getAllEpos(supabase, profile.id),
  getTravelLegs(supabase),
]);
```

After the `assignmentsByDate` map construction (after line 69), build a travel legs map:

```typescript
const travelLegsByDate = new Map<string, TravelLeg>(
  travelLegsRaw.map((tl: { date: string; action: string; location: string; time: string; companion: string; companion_pre_position_flight: string; teak_flight: string; companion_return_flight: string }) => [
    tl.date,
    {
      date: tl.date,
      action: tl.action as TravelLeg["action"],
      location: tl.location,
      time: tl.time,
      companion: tl.companion,
      companionPrePositionFlight: tl.companion_pre_position_flight,
      teakFlight: tl.teak_flight,
      companionReturnFlight: tl.companion_return_flight,
    },
  ])
);
```

Add `travelLeg` to the management entries map (around line 74):

```typescript
// OLD:
const entries: DashboardEntry[] = schedule
  .filter((s) => s.date >= today)
  .map((s) => ({
    ...s,
    detailLevel: settingsMap.get(s.date) ?? "single",
    assignedEpos: assignmentsByDate.get(s.date) ?? [],
    isThisWeek: isThisWeek(s.date),
    isNextWeek: isNextWeek(s.date),
  }));

// NEW:
const entries: DashboardEntry[] = schedule
  .filter((s) => s.date >= today)
  .map((s) => ({
    ...s,
    detailLevel: settingsMap.get(s.date) ?? "single",
    assignedEpos: assignmentsByDate.get(s.date) ?? [],
    isThisWeek: isThisWeek(s.date),
    isNextWeek: isNextWeek(s.date),
    travelLeg: travelLegsByDate.get(s.date),
  }));
```

- [ ] **Step 4: Replace `fetchTravelLegs()` with Supabase query in the EPO branch**

In the EPO branch (around line 97), replace `fetchTravelLegs()` with `getTravelLegs(supabase)` and add the same mapping:

```typescript
// OLD:
const [assignmentsRaw, myAssignments, travelLegsByDate] = await Promise.all([
  getAllAssignmentsWithProfiles(supabase),
  getAssignmentsForUser(supabase, profile.id),
  fetchTravelLegs(),
]);

// NEW:
const [assignmentsRaw, myAssignments, travelLegsRaw] = await Promise.all([
  getAllAssignmentsWithProfiles(supabase),
  getAssignmentsForUser(supabase, profile.id),
  getTravelLegs(supabase),
]);

const travelLegsByDate = new Map<string, TravelLeg>(
  travelLegsRaw.map((tl: { date: string; action: string; location: string; time: string; companion: string; companion_pre_position_flight: string; teak_flight: string; companion_return_flight: string }) => [
    tl.date,
    {
      date: tl.date,
      action: tl.action as TravelLeg["action"],
      location: tl.location,
      time: tl.time,
      companion: tl.companion,
      companionPrePositionFlight: tl.companion_pre_position_flight,
      teakFlight: tl.teak_flight,
      companionReturnFlight: tl.companion_return_flight,
    },
  ])
);
```

The existing `travelLeg: assignedDateSet.has(s.date) ? travelLegsByDate.get(s.date) : undefined` line in the EPO entries map stays exactly the same.

- [ ] **Step 5: Remove `fetchTravelLegs` from `src/lib/google-sheets.ts`**

Remove the `TEAK_AIRLINE_LEGS_RANGE` constant (line 200) and the entire `fetchTravelLegs` function (lines 202–225). Also remove the import of `buildTravelLegsMap` from `teak-airline-legs`:

```typescript
// Remove this import (find it near top of file):
import { buildTravelLegsMap } from "./teak-airline-legs";

// Remove this import from the type imports:
import type { TravelLeg } from "@/types/schedule";
// (only if TravelLeg is no longer used elsewhere in this file)
```

- [ ] **Step 6: Verify the app builds**

Run: `bun run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/page.tsx src/lib/google-sheets.ts
git commit -m "feat: fetch travel legs from Supabase instead of Google Sheets"
```

---

### Task 4: Delete Google Sheets travel leg parsing code

**Files:**
- Delete: `src/lib/teak-airline-legs.ts`
- Delete: `src/lib/teak-airline-legs.test.ts`

- [ ] **Step 1: Verify no other imports of teak-airline-legs**

Run: `grep -r "teak-airline-legs" src/`

Expected: No results (after Task 3, `google-sheets.ts` no longer imports it). If there are remaining imports, update those files first.

- [ ] **Step 2: Delete the files**

```bash
rm src/lib/teak-airline-legs.ts src/lib/teak-airline-legs.test.ts
```

- [ ] **Step 3: Verify build**

Run: `bun run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/teak-airline-legs.ts src/lib/teak-airline-legs.test.ts
git commit -m "chore: remove Google Sheets travel leg parser"
```

---

### Task 5: Add PICK UP / DROP OFF badges to management card header

**Files:**
- Modify: `src/components/management-card.tsx`

- [ ] **Step 1: Add travel leg badges to the collapsed header**

In `src/components/management-card.tsx`, find the header badges area (around line 57). Change the `<div>` wrapping the activity name and TEAK NIGHT badge to include `flex-wrap` and add the travel leg badges:

```typescript
// OLD (line 57):
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold text-gray-100">
              {entry.activity || "No activity listed"}
            </h3>
            {entry.teakNight && (
              <span className="shrink-0 rounded bg-purple-900/60 px-1.5 py-0.5 text-[10px] font-medium text-purple-300">
                TEAK NIGHT
              </span>
            )}
          </div>

// NEW:
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold text-gray-100">
              {entry.activity || "No activity listed"}
            </h3>
            {entry.teakNight && (
              <span className="shrink-0 rounded bg-purple-900/60 px-1.5 py-0.5 text-[10px] font-medium text-purple-300">
                TEAK NIGHT
              </span>
            )}
            {entry.travelLeg?.action === "Pick up" && (
              <span className="shrink-0 rounded bg-green-900/60 px-1.5 py-0.5 text-[10px] font-medium text-green-300">
                PICK UP
              </span>
            )}
            {entry.travelLeg?.action === "Drop off" && (
              <span className="shrink-0 rounded bg-rose-900/60 px-1.5 py-0.5 text-[10px] font-medium text-rose-300">
                DROP OFF
              </span>
            )}
          </div>
```

- [ ] **Step 2: Verify build**

Run: `bun run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/management-card.tsx
git commit -m "feat: show PICK UP / DROP OFF badges on management cards"
```

---

### Task 6: Create `TeakToggle` component

**Files:**
- Create: `src/components/teak-toggle.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/teak-toggle.tsx`:

```typescript
"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { TravelLeg } from "@/types/schedule";

interface TeakToggleProps {
  date: string;
  initialLeg?: TravelLeg;
  profileId: string;
}

const fieldDefs = [
  { key: "location", label: "Location", column: "location" },
  { key: "time", label: "Time", column: "time" },
  { key: "companion", label: "Companion", column: "companion" },
  { key: "companionPrePositionFlight", label: "Companion Pre-Position Flight", column: "companion_pre_position_flight" },
  { key: "teakFlight", label: "Teak Flight", column: "teak_flight" },
  { key: "companionReturnFlight", label: "Companion Return Flight", column: "companion_return_flight" },
] as const;

type FieldKey = (typeof fieldDefs)[number]["key"];

export function TeakToggle({ date, initialLeg, profileId }: TeakToggleProps) {
  const [leg, setLeg] = useState<TravelLeg | undefined>(initialLeg);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setLeg(initialLeg);
  }, [initialLeg]);

  const handleToggle = async (action: "Pick up" | "Drop off") => {
    if (saving) return;
    setSaving(true);
    const supabase = createClient();

    if (leg?.action === action) {
      const prev = leg;
      setLeg(undefined);
      const { error } = await supabase
        .from("travel_legs")
        .delete()
        .eq("date", date);
      if (error) {
        console.error("Delete travel leg failed:", error);
        setLeg(prev);
      } else {
        router.refresh();
      }
    } else if (leg) {
      const prev = leg;
      setLeg({ ...leg, action });
      const { error } = await supabase
        .from("travel_legs")
        .update({ action, updated_at: new Date().toISOString() })
        .eq("date", date);
      if (error) {
        console.error("Update travel leg action failed:", error);
        setLeg(prev);
      } else {
        router.refresh();
      }
    } else {
      const newLeg: TravelLeg = {
        date,
        action,
        location: "",
        time: "",
        companion: "",
        companionPrePositionFlight: "",
        teakFlight: "",
        companionReturnFlight: "",
      };
      setLeg(newLeg);
      const { error } = await supabase.from("travel_legs").insert({
        date,
        action,
        created_by: profileId,
      });
      if (error) {
        console.error("Insert travel leg failed:", error);
        setLeg(undefined);
      } else {
        router.refresh();
      }
    }
    setSaving(false);
  };

  const handleFieldBlur = async (fieldKey: FieldKey, value: string) => {
    if (!leg) return;
    const def = fieldDefs.find((f) => f.key === fieldKey);
    if (!def) return;

    const prev = leg;
    setLeg({ ...leg, [fieldKey]: value });

    const supabase = createClient();
    const { error } = await supabase
      .from("travel_legs")
      .update({ [def.column]: value, updated_at: new Date().toISOString() })
      .eq("date", date);
    if (error) {
      console.error(`Update ${def.column} failed:`, error);
      setLeg(prev);
    } else {
      router.refresh();
    }
  };

  const isPickUp = leg?.action === "Pick up";
  const isDropOff = leg?.action === "Drop off";

  return (
    <div className="border-t border-gray-700 pt-2.5">
      <div className="mb-1.5 text-[10px] text-gray-500">TEAK</div>
      <div className="flex gap-1.5">
        <button
          onClick={() => handleToggle("Pick up")}
          disabled={saving}
          className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
            isPickUp
              ? "bg-green-900/60 text-green-300"
              : "border border-gray-600 text-gray-500 hover:border-green-700 hover:text-green-400"
          } disabled:opacity-50`}
        >
          Pick Up
        </button>
        <button
          onClick={() => handleToggle("Drop off")}
          disabled={saving}
          className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
            isDropOff
              ? "bg-rose-900/60 text-rose-300"
              : "border border-gray-600 text-gray-500 hover:border-rose-700 hover:text-rose-400"
          } disabled:opacity-50`}
        >
          Drop Off
        </button>
      </div>

      {leg && (
        <div className="mt-2 space-y-2 rounded-md bg-gray-950/50 p-2.5">
          {fieldDefs.map((def) => (
            <TeakField
              key={def.key}
              label={def.label}
              value={leg[def.key]}
              onBlur={(value) => handleFieldBlur(def.key, value)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TeakField({
  label,
  value,
  onBlur,
}: {
  label: string;
  value: string;
  onBlur: (value: string) => void;
}) {
  const [local, setLocal] = useState(value);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  return (
    <div>
      <div className="mb-0.5 text-[10px] text-gray-500">{label}</div>
      <input
        type="text"
        className="w-full rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-100 focus:border-blue-500 focus:outline-none"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          if (local !== value) onBlur(local);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `bun run build`
Expected: Build succeeds (component not yet imported anywhere, but types should resolve).

- [ ] **Step 3: Commit**

```bash
git add src/components/teak-toggle.tsx
git commit -m "feat: add TeakToggle component for inline travel leg editing"
```

---

### Task 7: Add `TeakToggle` to `ManagementCard`

**Files:**
- Modify: `src/components/management-card.tsx`

- [ ] **Step 1: Add imports**

Add to the imports at the top of `src/components/management-card.tsx`:

```typescript
import { TeakToggle } from "./teak-toggle";
```

- [ ] **Step 2: Add `TeakToggle` to the expanded section**

In the expanded area of `ManagementCard` (inside the `{expanded && (` block), add `TeakToggle` after the `EpoAssignment` component (after line 128):

```typescript
// OLD (lines 123-129):
          <EpoAssignment
            date={entry.date}
            assignedEpos={entry.assignedEpos}
            allEpos={allEpos}
            profileId={profileId}
          />
        </div>

// NEW:
          <EpoAssignment
            date={entry.date}
            assignedEpos={entry.assignedEpos}
            allEpos={allEpos}
            profileId={profileId}
          />

          <TeakToggle
            date={entry.date}
            initialLeg={entry.travelLeg}
            profileId={profileId}
          />
        </div>
```

- [ ] **Step 3: Verify build**

Run: `bun run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/management-card.tsx
git commit -m "feat: add TeakToggle to management card expanded view"
```

---

### Task 8: Manual testing

**Files:** None (testing only)

- [ ] **Step 1: Start dev server**

Run: `bun run dev`

- [ ] **Step 2: Test management dashboard — toggle activation**

1. Log in as a management user
2. Expand any future date's card
3. Verify the TEAK section appears below EPO assignments with two muted buttons: "Pick Up" and "Drop Off"
4. Click "Pick Up" — button should become solid green, form should appear with 6 empty text fields, and a green "PICK UP" badge should appear in the card header
5. Click "Drop Off" — should switch: rose button active, green deactivated, badge changes to rose "DROP OFF"
6. Click the active "Drop Off" button again — should deactivate: both buttons muted, form collapses, badge disappears

- [ ] **Step 3: Test management dashboard — field editing**

1. Toggle "Pick Up" on a date
2. Type "LAX FBO" in the Location field
3. Click/tab out of the field (blur)
4. Collapse and re-expand the card — value should persist
5. Refresh the page — value should still be there (came from Supabase)

- [ ] **Step 4: Test EPO dashboard**

1. Log in as an EPO user
2. Navigate to a date that has a travel leg (created in step 2-3)
3. If the EPO is assigned to that date, verify the "Teak Pick-Up/Drop-Off" collapsible section appears with the correct data
4. If the EPO is NOT assigned to that date, verify no travel details section appears

- [ ] **Step 5: Test edge cases**

1. Verify a date with no travel leg shows no TEAK badge and no form
2. Verify creating a travel leg on one date doesn't affect other dates
3. Verify both Pick Up and Drop Off badges display correctly in collapsed card state

- [ ] **Step 6: Commit any fixes**

If any fixes were needed during testing, commit them:
```bash
git add <fixed-files>
git commit -m "fix: address issues found during manual testing"
```
