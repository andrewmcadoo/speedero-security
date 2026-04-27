# Calendar Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface Greg's and Krista's `TT:`-prefixed Google Calendar events on each day's `ScheduleDetailCard`, alongside the existing Teak Pickup / Drop Off sub-cards. Read-only mirror of two calendars, fetched live on each dashboard render.

**Architecture:** A new `src/lib/google-calendar.ts` peer of `google-sheets.ts` calls the Calendar API via the existing service-account auth (one call per principal, run in parallel). The dashboard server component adds the calendar fetch to its existing `Promise.all`, buckets transitions by their event-TZ date, and attaches a `transitions: Transition[]` array to every `DashboardEntry`. A new `<TransitionsSection>` renders inside the expanded card body, above the existing pickup/dropoff blocks, with two named subsections (Greg / Krista). Pure parsing/grouping logic is factored into TDD-tested pure functions; the network shell is exercised by manual smoke-test (matches existing `google-sheets.ts` pattern).

**Tech Stack:** Next.js 16 (App Router, RSC), TypeScript, `google-auth-library`, Tailwind v4, Bun (package manager + `bun test` runner).

**Spec:** `docs/superpowers/specs/2026-04-26-calendar-transitions-design.md`

---

## File Structure

**Create:**

- `src/lib/google-calendar.ts` — service-account-authed Calendar API client. Public function `fetchTransitions(range)`. Internally exposes pure helpers `stripTransitionPrefix`, `parseCalendarEvents`, `getConfiguredPrincipals` for unit testing.
- `src/lib/google-calendar.test.ts` — bun unit tests for the pure helpers (no live API).
- `src/components/transitions-section.tsx` — pure presentational component; reads transitions and renders two named subsections. Server component (no `"use client"`).

**Modify:**

- `src/types/schedule.ts` — add `Principal` union and `Transition` interface; add `transitions: Transition[]` (required) to `DashboardEntry`.
- `src/lib/schedule-utils.ts` — add `isoDateInTz` and `formatTimeInTz` helpers.
- `src/lib/schedule-utils.test.ts` — tests for the two new helpers.
- `src/app/dashboard/page.tsx` — add `fetchTransitionsData` wrapper + range derivation; add to `Promise.all`; build `transitionsByDate` map; attach `transitions` to entries in both management and EPO views.
- `src/components/schedule-detail-card.tsx` — render `<TransitionsSection>` between `<FlightDetailsSection>` and the pickup/dropoff blocks.
- `.env.local.example` — document the two new env vars.

---

## Task 1: Add `Principal` / `Transition` types and plumb empty array through dashboard

This task adds the type surface in lockstep with all `DashboardEntry` literals so the build stays green. The actual fetch lands in Task 5.

**Files:**
- Modify: `src/types/schedule.ts`
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Add `Principal` and `Transition` to `src/types/schedule.ts` and extend `DashboardEntry`**

Append to the bottom of `src/types/schedule.ts`:

```ts
export type Principal = "greg" | "krista";

export interface Transition {
  person: Principal;
  title: string;     // event summary with leading "TT:" stripped + trimmed
  startsAt: string;  // ISO 8601 with offset, e.g. "2026-04-30T09:30:00-07:00"
  tz: string;        // event's IANA timezone, e.g. "America/Los_Angeles"
  eventId: string;   // Google Calendar event id (instance id for recurring) — React key
}
```

Then modify the existing `DashboardEntry` interface (around line 54) to add the required `transitions` field. Replace the existing `DashboardEntry` block with:

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
}
```

- [ ] **Step 2: Add `transitions: []` to both `DashboardEntry` literals in `src/app/dashboard/page.tsx`**

Two literals need updating (the build will fail otherwise because `transitions` is required).

In the management branch (~line 107), replace the existing return literal with:

```ts
        return {
          ...s,
          detailLevel: setting?.detailLevel ?? "single",
          assignedEpos: assignmentsByDate.get(s.date) ?? [],
          isThisWeek: isThisWeek(s.date),
          isNextWeek: isNextWeek(s.date),
          pickupLeg: legs?.pickup,
          dropoffLeg: legs?.dropoff,
          transitions: [],
        };
```

In the EPO branch (~line 167), replace the existing return literal with:

```ts
    return {
      ...s,
      detailLevel: setting?.detailLevel ?? "single",
      assignedEpos: assignmentsByDate.get(s.date) ?? [],
      isPast: s.date < today,
      isThisWeek: isThisWeek(s.date),
      isNextWeek: isNextWeek(s.date),
      pickupLeg: legs?.pickup,
      dropoffLeg: legs?.dropoff,
      transitions: [],
    };
```

- [ ] **Step 3: Verify build still passes**

Run: `bun run build`
Expected: build succeeds with no type errors.

- [ ] **Step 4: Run existing tests to confirm nothing regressed**

Run: `bun test`
Expected: all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/types/schedule.ts src/app/dashboard/page.tsx
git commit -m "feat(transitions): add Principal/Transition types and stub empty array on DashboardEntry"
```

---

## Task 2: Add `isoDateInTz` helper to `schedule-utils.ts` (TDD)

Pure function that returns `YYYY-MM-DD` for an ISO timestamp interpreted in a given IANA timezone. Used to bucket transitions by the date the principal would see on their phone.

**Files:**
- Modify: `src/lib/schedule-utils.test.ts`
- Modify: `src/lib/schedule-utils.ts`

- [ ] **Step 1: Write failing tests**

Append to the bottom of `src/lib/schedule-utils.test.ts`:

```ts
import { isoDateInTz } from "./schedule-utils";

describe("isoDateInTz", () => {
  test("returns wall-clock date in the given timezone", () => {
    // 2026-04-30T09:30:00-07:00 = 2026-04-30 16:30 UTC
    expect(isoDateInTz("2026-04-30T09:30:00-07:00", "America/Los_Angeles")).toBe("2026-04-30");
  });

  test("buckets to event's TZ date even when UTC date differs", () => {
    // 2026-04-30T23:30-07:00 = 2026-05-01 06:30 UTC
    // In LA the wall clock is still April 30; in UTC it's May 1.
    expect(isoDateInTz("2026-04-30T23:30:00-07:00", "America/Los_Angeles")).toBe("2026-04-30");
    expect(isoDateInTz("2026-04-30T23:30:00-07:00", "UTC")).toBe("2026-05-01");
  });

  test("handles same instant in two different zones", () => {
    // 2026-05-01T15:30:00+09:00 (Tokyo) = 2026-04-30T23:30 PT = 2026-05-01 06:30 UTC
    expect(isoDateInTz("2026-05-01T15:30:00+09:00", "Asia/Tokyo")).toBe("2026-05-01");
    expect(isoDateInTz("2026-05-01T15:30:00+09:00", "America/Los_Angeles")).toBe("2026-04-30");
  });

  test("handles DST spring-forward day", () => {
    // 2026-03-08 is the US DST spring-forward day. 2026-03-08T03:30-07:00 (after DST starts) is March 8 in LA.
    expect(isoDateInTz("2026-03-08T03:30:00-07:00", "America/Los_Angeles")).toBe("2026-03-08");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/schedule-utils.test.ts`
Expected: FAIL with "isoDateInTz is not a function" (or similar) — the function does not yet exist.

- [ ] **Step 3: Implement `isoDateInTz`**

Append to the bottom of `src/lib/schedule-utils.ts`:

```ts
/**
 * Format an ISO 8601 instant as a YYYY-MM-DD calendar date in the given
 * IANA timezone (e.g. "America/Los_Angeles", "Asia/Tokyo", "UTC").
 *
 * Used to bucket calendar events by the date the event "owner" sees on
 * their phone, regardless of UTC offset or viewer locale.
 */
export function isoDateInTz(iso: string, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date(iso));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/schedule-utils.test.ts`
Expected: PASS — all four `isoDateInTz` cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/schedule-utils.ts src/lib/schedule-utils.test.ts
git commit -m "feat(schedule-utils): add isoDateInTz for TZ-aware date bucketing"
```

---

## Task 3: Add `formatTimeInTz` helper to `schedule-utils.ts` (TDD)

Pure function that returns a 12-hour-clock display string for an ISO timestamp in a given timezone. Used by the transitions UI to render each event's start time.

**Files:**
- Modify: `src/lib/schedule-utils.test.ts`
- Modify: `src/lib/schedule-utils.ts`

- [ ] **Step 1: Write failing tests**

Append to the bottom of `src/lib/schedule-utils.test.ts`:

```ts
import { formatTimeInTz } from "./schedule-utils";

describe("formatTimeInTz", () => {
  test("formats a morning time in the event's TZ", () => {
    expect(formatTimeInTz("2026-04-30T09:30:00-07:00", "America/Los_Angeles")).toBe("9:30 AM");
  });

  test("formats an afternoon time", () => {
    expect(formatTimeInTz("2026-04-30T14:05:00-07:00", "America/Los_Angeles")).toBe("2:05 PM");
  });

  test("renders the same instant differently in two zones", () => {
    // Same instant: 06:30 UTC. In Tokyo that's 15:30; in LA it's 23:30 of the prior day.
    const iso = "2026-05-01T06:30:00Z";
    expect(formatTimeInTz(iso, "Asia/Tokyo")).toBe("3:30 PM");
    expect(formatTimeInTz(iso, "America/Los_Angeles")).toBe("11:30 PM");
  });

  test("pads single-digit minutes", () => {
    expect(formatTimeInTz("2026-04-30T09:05:00-07:00", "America/Los_Angeles")).toBe("9:05 AM");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/schedule-utils.test.ts`
Expected: FAIL with "formatTimeInTz is not a function".

- [ ] **Step 3: Implement `formatTimeInTz`**

Append to the bottom of `src/lib/schedule-utils.ts`:

```ts
/**
 * Format an ISO 8601 instant as a 12-hour clock string ("9:30 AM") in the
 * given IANA timezone. Used by the transitions UI to render event start
 * times in the principal's local zone.
 */
export function formatTimeInTz(iso: string, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return fmt.format(new Date(iso));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/schedule-utils.test.ts`
Expected: PASS — all `formatTimeInTz` cases (and existing `isoDateInTz` / others).

- [ ] **Step 5: Commit**

```bash
git add src/lib/schedule-utils.ts src/lib/schedule-utils.test.ts
git commit -m "feat(schedule-utils): add formatTimeInTz for TZ-aware time display"
```

---

## Task 4: Add `stripTransitionPrefix` helper (TDD)

The smallest pure unit: strips a `TT:` prefix (case-insensitive, optional whitespace) from a calendar event title and trims. Returns `null` if the post-strip title is empty or the input does not match the prefix pattern.

**Files:**
- Create: `src/lib/google-calendar.ts`
- Create: `src/lib/google-calendar.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/google-calendar.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { stripTransitionPrefix } from "./google-calendar";

describe("stripTransitionPrefix", () => {
  test("strips standard 'TT: ' prefix", () => {
    expect(stripTransitionPrefix("TT: Studio")).toBe("Studio");
  });

  test("is case-insensitive", () => {
    expect(stripTransitionPrefix("tt: home")).toBe("home");
    expect(stripTransitionPrefix("Tt: airport")).toBe("airport");
  });

  test("accepts no whitespace after colon", () => {
    expect(stripTransitionPrefix("TT:Studio")).toBe("Studio");
  });

  test("accepts multiple spaces after colon", () => {
    expect(stripTransitionPrefix("TT:   Office")).toBe("Office");
  });

  test("trims trailing whitespace", () => {
    expect(stripTransitionPrefix("TT: Studio   ")).toBe("Studio");
  });

  test("returns null for non-matching titles", () => {
    expect(stripTransitionPrefix("Studio")).toBeNull();
    expect(stripTransitionPrefix("Matt: meeting")).toBeNull(); // contains TT: as substring but not at start
  });

  test("returns null when title is just the prefix with empty body", () => {
    expect(stripTransitionPrefix("TT:")).toBeNull();
    expect(stripTransitionPrefix("TT:   ")).toBeNull();
    expect(stripTransitionPrefix("  TT:  ")).toBeNull();
  });

  test("accepts leading whitespace before prefix", () => {
    expect(stripTransitionPrefix("  TT: Office")).toBe("Office");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/google-calendar.test.ts`
Expected: FAIL — `google-calendar.ts` does not exist yet (module-not-found error).

- [ ] **Step 3: Implement `stripTransitionPrefix`**

Create `src/lib/google-calendar.ts` with just the helper:

```ts
const TRANSITION_PREFIX_RE = /^\s*tt:\s*/i;

/**
 * If `title` begins with a `TT:` prefix (case-insensitive, allowing leading
 * whitespace and optional whitespace after the colon), return the title
 * with the prefix stripped and trimmed. Otherwise (or if the post-strip
 * title is empty), return `null`.
 */
export function stripTransitionPrefix(title: string): string | null {
  if (!TRANSITION_PREFIX_RE.test(title)) return null;
  const stripped = title.replace(TRANSITION_PREFIX_RE, "").trim();
  return stripped === "" ? null : stripped;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/google-calendar.test.ts`
Expected: PASS — all 8 cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/google-calendar.ts src/lib/google-calendar.test.ts
git commit -m "feat(transitions): add stripTransitionPrefix helper"
```

---

## Task 5: Add `parseCalendarEvents` per-principal parser (TDD)

Takes a `Principal` and a slice of Google Calendar API event objects; returns the `Transition[]` for that principal. Filters out all-day events and events whose post-strip title is empty.

**Files:**
- Modify: `src/lib/google-calendar.test.ts`
- Modify: `src/lib/google-calendar.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/lib/google-calendar.test.ts`:

```ts
import { parseCalendarEvents, type CalendarApiEvent } from "./google-calendar";
import type { Transition } from "@/types/schedule";

const baseEvent = (overrides: Partial<CalendarApiEvent>): CalendarApiEvent => ({
  id: "evt_default",
  summary: "TT: Default",
  start: { dateTime: "2026-04-30T09:30:00-07:00", timeZone: "America/Los_Angeles" },
  ...overrides,
});

describe("parseCalendarEvents", () => {
  test("parses a single timed TT: event into a Transition", () => {
    const result = parseCalendarEvents("greg", [
      baseEvent({ id: "evt_1", summary: "TT: Studio" }),
    ]);
    expect(result).toEqual<Transition[]>([
      {
        person: "greg",
        title: "Studio",
        startsAt: "2026-04-30T09:30:00-07:00",
        tz: "America/Los_Angeles",
        eventId: "evt_1",
      },
    ]);
  });

  test("skips all-day events (no dateTime, only date)", () => {
    const result = parseCalendarEvents("greg", [
      { id: "evt_a", summary: "TT: All day", start: { date: "2026-04-30" } },
    ]);
    expect(result).toEqual([]);
  });

  test("skips events whose post-strip title is empty", () => {
    const result = parseCalendarEvents("greg", [
      baseEvent({ id: "evt_b", summary: "TT:" }),
      baseEvent({ id: "evt_c", summary: "TT:   " }),
    ]);
    expect(result).toEqual([]);
  });

  test("skips events without TT: prefix", () => {
    const result = parseCalendarEvents("greg", [
      baseEvent({ id: "evt_d", summary: "Studio" }),
      baseEvent({ id: "evt_e", summary: "Matt: meeting" }),
    ]);
    expect(result).toEqual([]);
  });

  test("falls back to UTC when timeZone is missing", () => {
    const result = parseCalendarEvents("krista", [
      {
        id: "evt_f",
        summary: "TT: Office",
        start: { dateTime: "2026-04-30T09:30:00Z" }, // no timeZone
      },
    ]);
    expect(result[0].tz).toBe("UTC");
  });

  test("preserves the person tag passed in", () => {
    const result = parseCalendarEvents("krista", [
      baseEvent({ id: "evt_g", summary: "TT: Hair" }),
    ]);
    expect(result[0].person).toBe("krista");
  });

  test("skips events missing summary", () => {
    const result = parseCalendarEvents("greg", [
      { id: "evt_h", start: { dateTime: "2026-04-30T09:30:00-07:00", timeZone: "America/Los_Angeles" } },
    ]);
    expect(result).toEqual([]);
  });

  test("skips events missing id", () => {
    const result = parseCalendarEvents("greg", [
      { summary: "TT: Office", start: { dateTime: "2026-04-30T09:30:00-07:00", timeZone: "America/Los_Angeles" } } as CalendarApiEvent,
    ]);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/google-calendar.test.ts`
Expected: FAIL — `parseCalendarEvents` and `CalendarApiEvent` are not exported yet.

- [ ] **Step 3: Implement `parseCalendarEvents` and the `CalendarApiEvent` type**

Append to `src/lib/google-calendar.ts`:

```ts
import type { Principal, Transition } from "@/types/schedule";

/**
 * Subset of the Google Calendar API event shape we rely on.
 * Full schema: https://developers.google.com/calendar/api/v3/reference/events
 */
export interface CalendarApiEvent {
  id?: string;
  summary?: string;
  start?: {
    date?: string;       // YYYY-MM-DD for all-day events
    dateTime?: string;   // RFC3339 for timed events
    timeZone?: string;   // IANA TZ name
  };
}

/**
 * Convert a slice of Calendar API events for a single principal into
 * `Transition` objects. Drops all-day events, untitled events, events
 * whose title doesn't start with `TT:`, and events whose post-strip
 * title is empty.
 */
export function parseCalendarEvents(
  person: Principal,
  events: CalendarApiEvent[]
): Transition[] {
  const transitions: Transition[] = [];
  for (const event of events) {
    if (!event.id) continue;
    if (!event.summary) continue;
    const startsAt = event.start?.dateTime;
    if (!startsAt) continue; // all-day or malformed
    const title = stripTransitionPrefix(event.summary);
    if (title === null) continue;
    transitions.push({
      person,
      title,
      startsAt,
      tz: event.start?.timeZone ?? "UTC",
      eventId: event.id,
    });
  }
  return transitions;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/google-calendar.test.ts`
Expected: PASS — all `parseCalendarEvents` cases plus the existing `stripTransitionPrefix` cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/google-calendar.ts src/lib/google-calendar.test.ts
git commit -m "feat(transitions): add parseCalendarEvents per-principal parser"
```

---

## Task 6: Add `getConfiguredPrincipals` env reader (TDD)

Reads `GOOGLE_CALENDAR_ID_GREG` and `GOOGLE_CALENDAR_ID_KRISTA`. Returns the principals that have a non-empty calendar ID configured. Used by the network shell to skip principals with missing config and to log a warning per skip.

**Files:**
- Modify: `src/lib/google-calendar.test.ts`
- Modify: `src/lib/google-calendar.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/lib/google-calendar.test.ts`:

```ts
import { afterEach, beforeEach } from "bun:test";
import { getConfiguredPrincipals } from "./google-calendar";

describe("getConfiguredPrincipals", () => {
  const originalGreg = process.env.GOOGLE_CALENDAR_ID_GREG;
  const originalKrista = process.env.GOOGLE_CALENDAR_ID_KRISTA;
  let warnings: unknown[][] = [];
  let originalWarn: typeof console.warn;

  beforeEach(() => {
    delete process.env.GOOGLE_CALENDAR_ID_GREG;
    delete process.env.GOOGLE_CALENDAR_ID_KRISTA;
    warnings = [];
    originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
  });

  afterEach(() => {
    if (originalGreg !== undefined) process.env.GOOGLE_CALENDAR_ID_GREG = originalGreg;
    else delete process.env.GOOGLE_CALENDAR_ID_GREG;
    if (originalKrista !== undefined) process.env.GOOGLE_CALENDAR_ID_KRISTA = originalKrista;
    else delete process.env.GOOGLE_CALENDAR_ID_KRISTA;
    console.warn = originalWarn;
  });

  test("returns both principals when both env vars are set", () => {
    process.env.GOOGLE_CALENDAR_ID_GREG = "greg@example.com";
    process.env.GOOGLE_CALENDAR_ID_KRISTA = "krista@example.com";
    expect(getConfiguredPrincipals()).toEqual([
      { person: "greg", calendarId: "greg@example.com" },
      { person: "krista", calendarId: "krista@example.com" },
    ]);
    expect(warnings).toEqual([]);
  });

  test("skips and warns about a missing principal", () => {
    process.env.GOOGLE_CALENDAR_ID_GREG = "greg@example.com";
    // Krista's env var unset
    const result = getConfiguredPrincipals();
    expect(result).toEqual([{ person: "greg", calendarId: "greg@example.com" }]);
    expect(warnings.length).toBe(1);
    expect(String(warnings[0][0])).toContain("krista");
  });

  test("skips and warns when env var is empty string", () => {
    process.env.GOOGLE_CALENDAR_ID_GREG = "";
    process.env.GOOGLE_CALENDAR_ID_KRISTA = "krista@example.com";
    const result = getConfiguredPrincipals();
    expect(result).toEqual([{ person: "krista", calendarId: "krista@example.com" }]);
    expect(warnings.length).toBe(1);
    expect(String(warnings[0][0])).toContain("greg");
  });

  test("returns empty array when neither is configured", () => {
    expect(getConfiguredPrincipals()).toEqual([]);
    expect(warnings.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/google-calendar.test.ts`
Expected: FAIL — `getConfiguredPrincipals` is not exported yet.

- [ ] **Step 3: Implement `getConfiguredPrincipals`**

Append to `src/lib/google-calendar.ts`:

```ts
const PRINCIPAL_CALENDARS: { person: Principal; envVar: string }[] = [
  { person: "greg", envVar: "GOOGLE_CALENDAR_ID_GREG" },
  { person: "krista", envVar: "GOOGLE_CALENDAR_ID_KRISTA" },
];

export interface ConfiguredPrincipal {
  person: Principal;
  calendarId: string;
}

/**
 * Read the calendar ID env vars and return one entry per principal that
 * has a non-empty value. Logs a warning for each missing principal so
 * preview environments (which may only have one calendar shared) don't
 * silently drop transitions for the missing one.
 */
export function getConfiguredPrincipals(): ConfiguredPrincipal[] {
  const out: ConfiguredPrincipal[] = [];
  for (const { person, envVar } of PRINCIPAL_CALENDARS) {
    const calendarId = process.env[envVar];
    if (!calendarId) {
      console.warn(`[transitions] ${envVar} is not set; skipping ${person}`);
      continue;
    }
    out.push({ person, calendarId });
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/google-calendar.test.ts`
Expected: PASS — all `getConfiguredPrincipals` cases plus prior cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/google-calendar.ts src/lib/google-calendar.test.ts
git commit -m "feat(transitions): add getConfiguredPrincipals env reader"
```

---

## Task 7: Add `fetchTransitions` network shell

Wires the existing service-account auth (same env vars as `google-sheets.ts`) to the Calendar API per principal, parses each response with `parseCalendarEvents`, merges across principals, and returns a `Transition[]` sorted ascending by `startsAt`. Per-principal failures degrade gracefully.

The shell itself isn't unit-tested (matches the existing pattern in `google-sheets.ts` — auth + fetch is verified manually). All risky logic is in the pure helpers tested by Tasks 4–6.

**Files:**
- Modify: `src/lib/google-calendar.ts`

- [ ] **Step 1: Add `fetchTransitions` and a private helper for the per-principal call**

Append to `src/lib/google-calendar.ts`:

```ts
import { GoogleAuth } from "google-auth-library";

const CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"];

function getAuth() {
  return new GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    },
    scopes: CALENDAR_SCOPES,
  });
}

/**
 * Pad a `YYYY-MM-DD` date string by ±1 day and return RFC3339 UTC bounds.
 * The padding absorbs event-TZ vs. UTC date-boundary skew so events that
 * fall on the requested calendar date in their own TZ are not dropped by
 * the API's UTC-based timeMin/timeMax filter.
 */
function paddedRfc3339Bounds(startDate: string, endDate: string): { timeMin: string; timeMax: string } {
  const start = new Date(`${startDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date(`${endDate}T23:59:59Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}

async function fetchPrincipalTransitions(
  accessToken: string,
  principal: ConfiguredPrincipal,
  bounds: { timeMin: string; timeMax: string }
): Promise<Transition[]> {
  const params = new URLSearchParams({
    timeMin: bounds.timeMin,
    timeMax: bounds.timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    q: "TT:",
    maxResults: "2500",
  });
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
    principal.calendarId
  )}/events?${params.toString()}`;

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      console.error(
        `[transitions] Calendar fetch for ${principal.person} failed: ${response.status} ${response.statusText}`
      );
      return [];
    }
    const data = (await response.json()) as { items?: CalendarApiEvent[] };
    return parseCalendarEvents(principal.person, data.items ?? []);
  } catch (error) {
    console.error(`[transitions] Calendar fetch for ${principal.person} threw:`, error);
    return [];
  }
}

/**
 * Fetch TT: transitions across all configured principals' Google Calendars
 * for the given inclusive date range. Returns a flat array sorted ascending
 * by startsAt. Per-principal failures degrade to an empty contribution from
 * that principal; the call as a whole only throws if obtaining the access
 * token fails.
 */
export async function fetchTransitions(
  range: { startDate: string; endDate: string }
): Promise<Transition[]> {
  const principals = getConfiguredPrincipals();
  if (principals.length === 0) return [];

  const auth = getAuth();
  const accessToken = await auth.getAccessToken();
  if (!accessToken) throw new Error("Missing Google Calendar access token");

  const bounds = paddedRfc3339Bounds(range.startDate, range.endDate);

  const perPrincipal = await Promise.all(
    principals.map((p) => fetchPrincipalTransitions(accessToken, p, bounds))
  );

  const merged = perPrincipal.flat();
  merged.sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0));
  return merged;
}
```

- [ ] **Step 2: Type-check the file**

Run: `bun run build`
Expected: build succeeds — no type errors. (No test runs needed; this task is a network shell exercised in Task 9.)

- [ ] **Step 3: Run all tests to confirm prior tests still pass**

Run: `bun test`
Expected: PASS — no regressions in the pure helpers.

- [ ] **Step 4: Commit**

```bash
git add src/lib/google-calendar.ts
git commit -m "feat(transitions): add fetchTransitions network shell"
```

---

## Task 8: Wire `fetchTransitions` into the dashboard

Add a `fetchTransitionsData` wrapper (mirroring `fetchScheduleData`), derive the date range from the schedule, add to `Promise.all`, build the per-date bucket map, and replace the empty-array placeholders from Task 1 with real lookups in both the management and EPO branches.

**Files:**
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Add imports and the `fetchTransitionsData` wrapper**

At the top of `src/app/dashboard/page.tsx`, update the existing imports:

- Add `Transition` to the existing `@/types/schedule` import:

```ts
import type { ScheduleEntry, DashboardEntry, DetailLevel, TravelLeg, Transition } from "@/types/schedule";
```

- Add `isoDateInTz` to the existing `@/lib/schedule-utils` import:

```ts
import { isThisWeek, isNextWeek, getAnchorDates, isoDateInTz } from "@/lib/schedule-utils";
```

- Add a new import for the calendar fetch:

```ts
import { fetchTransitions } from "@/lib/google-calendar";
```

Then, immediately after the existing `fetchScheduleData` function (around line 45), add the new wrapper:

```ts
async function fetchTransitionsData(
  range: { startDate: string; endDate: string }
): Promise<Transition[]> {
  try {
    return await fetchTransitions(range);
  } catch (error) {
    console.error("fetchTransitions failed:", error);
    return [];
  }
}
```

- [ ] **Step 2: Add a helper to bucket transitions by event-TZ date and log orphans**

Immediately after `fetchTransitionsData`, add:

```ts
function buildTransitionsByDate(
  transitions: Transition[],
  knownDates: Set<string>
): Map<string, Transition[]> {
  const map = new Map<string, Transition[]>();
  let orphanCount = 0;
  for (const t of transitions) {
    const date = isoDateInTz(t.startsAt, t.tz);
    if (!knownDates.has(date)) {
      orphanCount++;
      continue;
    }
    const list = map.get(date) ?? [];
    list.push(t);
    map.set(date, list);
  }
  if (orphanCount > 0) {
    console.warn(
      `[transitions] dropped ${orphanCount} transition(s) on dates with no schedule row`
    );
  }
  return map;
}
```

- [ ] **Step 3: Kick off the transitions fetch without awaiting it**

The transitions fetch's date range depends on `schedule` (we use `max(s.date)` as the end), so it can't go inside the first `Promise.all`. But by starting the promise right after the first `Promise.all` resolves and awaiting it later (just before building entries), it overlaps with the branch-specific Supabase `Promise.all` further down.

Find the existing first `Promise.all` block (around line 63) and append the transitions kickoff immediately after:

```ts
  const [schedule, dateSettings] = await Promise.all([
    fetchScheduleData(),
    getDateSettings(supabase),
  ]);

  // Kick off the transitions fetch in parallel with the branch-specific
  // Supabase fetches further down. Date range: today through the latest
  // sheet date. If the schedule fetch failed/returned empty, skip the
  // calendar call entirely.
  const transitionsPromise: Promise<Transition[]> =
    schedule.length === 0
      ? Promise.resolve([])
      : fetchTransitionsData({
          startDate: today,
          endDate: schedule.reduce((max, s) => (s.date > max ? s.date : max), today),
        });
```

Note: `today` is already in scope from the existing `getAnchorDates()` call at line 61. We do **not** `await transitionsPromise` here — it stays pending so the branch-specific fetches can run concurrently.

- [ ] **Step 4: Resolve transitions and build the bucket map in the management branch, then use it**

Inside the `if (isManagement)` block, after the existing branch-specific `Promise.all` (around line 81) and **before** the existing `assignmentsByDate` map building, add:

```ts
    const transitions = await transitionsPromise;
    const knownDates = new Set(schedule.map((s) => s.date));
    const transitionsByDate = buildTransitionsByDate(transitions, knownDates);
```

Then in the same branch's `entries` builder (~line 102), replace the placeholder line:

```ts
          transitions: [],
```

with the real lookup:

```ts
          transitions: transitionsByDate.get(s.date) ?? [],
```

- [ ] **Step 5: Resolve transitions and build the bucket map in the EPO branch, then use it**

Inside the EPO branch (the code after `if (isManagement) {...}` returns), after the existing branch-specific `Promise.all` (around line 138) and **before** the existing `assignmentsByDate` map building, add:

```ts
  const transitions = await transitionsPromise;
  const knownDates = new Set(schedule.map((s) => s.date));
  const transitionsByDate = buildTransitionsByDate(transitions, knownDates);
```

Then in the EPO branch's `entries` builder (~line 162), replace the placeholder line:

```ts
      transitions: [],
```

with the real lookup:

```ts
      transitions: transitionsByDate.get(s.date) ?? [],
```

- [ ] **Step 6: Verify the build**

Run: `bun run build`
Expected: build succeeds with no type errors.

- [ ] **Step 7: Run all tests**

Run: `bun test`
Expected: PASS — no regressions.

- [ ] **Step 8: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat(transitions): wire fetchTransitions into dashboard with TZ-aware date bucketing"
```

---

## Task 9: Build `<TransitionsSection>` component

Pure presentational component. Renders nothing if there are zero transitions or if a person's subsection is empty. Group order is fixed (Greg, then Krista) by a constant inside the component.

**Files:**
- Create: `src/components/transitions-section.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/transitions-section.tsx`:

```tsx
import type { Principal, Transition } from "@/types/schedule";
import { formatTimeInTz } from "@/lib/schedule-utils";

interface TransitionsSectionProps {
  transitions: Transition[];
}

const GROUPS: { person: Principal; label: string }[] = [
  { person: "greg", label: "Greg" },
  { person: "krista", label: "Krista" },
];

export function TransitionsSection({ transitions }: TransitionsSectionProps) {
  if (transitions.length === 0) return null;

  const visible = GROUPS.map(({ person, label }) => ({
    person,
    label,
    items: transitions.filter((t) => t.person === person),
  })).filter((g) => g.items.length > 0);

  if (visible.length === 0) return null;

  return (
    <div className="space-y-3">
      {visible.map(({ person, label, items }) => (
        <div key={person}>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">
            {label}
          </div>
          <ul className="space-y-1">
            {items.map((t) => (
              <li key={t.eventId} className="flex items-baseline gap-2">
                <span className="shrink-0 font-mono text-[11px] text-gray-400">
                  {formatTimeInTz(t.startsAt, t.tz)}
                </span>
                <span className="text-xs text-gray-100">{t.title}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
```

Notes for the implementer:
- This is a server component on purpose — no `"use client"` directive, no event handlers, no React state. Sorting was done at the data layer.
- The component imports `Principal` even though it's only used in the `GROUPS` constant typing — keep that import; the strict-mode TS config will flag the constant otherwise.

- [ ] **Step 2: Verify the build**

Run: `bun run build`
Expected: build succeeds with no type errors and no React warnings.

- [ ] **Step 3: Commit**

```bash
git add src/components/transitions-section.tsx
git commit -m "feat(transitions): add TransitionsSection component"
```

---

## Task 10: Mount `<TransitionsSection>` inside `ScheduleDetailCard`

Render the transitions section inside the expanded body, between `<FlightDetailsSection>` and the existing pickup/dropoff blocks.

**Files:**
- Modify: `src/components/schedule-detail-card.tsx`

- [ ] **Step 1: Add the import**

Near the other component imports at the top of `src/components/schedule-detail-card.tsx`, add:

```tsx
import { TransitionsSection } from "./transitions-section";
```

- [ ] **Step 2: Render the section above pickup/dropoff in the expanded body**

Find the existing block in the expanded body (currently around line 141):

```tsx
          <FlightDetailsSection entry={entry} />
          {entry.pickupLeg && <TravelDetailsSection leg={entry.pickupLeg} />}
          {entry.dropoffLeg && <TravelDetailsSection leg={entry.dropoffLeg} />}
```

Replace with:

```tsx
          <FlightDetailsSection entry={entry} />
          <TransitionsSection transitions={entry.transitions} />
          {entry.pickupLeg && <TravelDetailsSection leg={entry.pickupLeg} />}
          {entry.dropoffLeg && <TravelDetailsSection leg={entry.dropoffLeg} />}
```

- [ ] **Step 3: Verify the build**

Run: `bun run build`
Expected: build succeeds.

- [ ] **Step 4: Run lint**

Run: `bun run lint`
Expected: clean (no warnings or errors introduced).

- [ ] **Step 5: Commit**

```bash
git add src/components/schedule-detail-card.tsx
git commit -m "feat(transitions): render TransitionsSection in expanded card body"
```

---

## Task 11: Document new env vars in `.env.local.example`

**Files:**
- Modify: `.env.local.example`

- [ ] **Step 1: Append the new env vars**

Append to the bottom of `.env.local.example`:

```
# Google Calendar API (reuses the Sheets service account; needs calendar.readonly scope
# added and each calendar shared with GOOGLE_SHEETS_CLIENT_EMAIL)
GOOGLE_CALENDAR_ID_GREG=greg-calendar-id@group.calendar.google.com
GOOGLE_CALENDAR_ID_KRISTA=krista-calendar-id@group.calendar.google.com
```

- [ ] **Step 2: Commit**

```bash
git add .env.local.example
git commit -m "docs(env): document GOOGLE_CALENDAR_ID_GREG/KRISTA"
```

---

## Task 12: Manual smoke test and final verification

**Files:**
- (no code changes)

- [ ] **Step 1: Confirm calendar IDs are set in `.env.local`**

In your local `.env.local`, set both `GOOGLE_CALENDAR_ID_GREG` and `GOOGLE_CALENDAR_ID_KRISTA` to real calendar IDs that have been shared with the existing service account. Confirm the service account has the `https://www.googleapis.com/auth/calendar.readonly` scope.

- [ ] **Step 2: Add at least one `TT:` test event to each calendar**

In Google Calendar, on a date that already exists in the master sheet:
- Add a timed event with summary `TT: Smoke Test Greg` to Greg's calendar (any time of day).
- Add a timed event with summary `TT: Smoke Test Krista` to Krista's calendar on the same date.

Add a second `TT:` event to one of them on the same date to confirm multiple-per-person rendering.

- [ ] **Step 3: Run the dev server and inspect the dashboard**

Run: `bun run dev`
Open the dashboard, log in (both as a management user and as an EPO assigned to that date if possible), expand the card for the test date.

Verify:
- The expanded body shows a "Greg" subsection above pickup/dropoff with the smoke-test event(s), each as `<time> <title>`.
- The "Krista" subsection appears below "Greg" with her event.
- Times render in the event's own timezone (not UTC, not viewer-local — verify by setting one event's timezone to a non-LA zone in Google Calendar).
- Both EPO and management dashboards show the section.
- A date with no `TT:` events does not render a transitions section at all.
- The collapsed card header is unchanged (no new chips).

- [ ] **Step 4: Confirm graceful degradation**

Temporarily unset `GOOGLE_CALENDAR_ID_KRISTA` in `.env.local` and restart the dev server. Reload the dashboard.

Verify:
- Greg's transitions still appear; Krista's section does not.
- The server log includes `[transitions] GOOGLE_CALENDAR_ID_KRISTA is not set; skipping krista`.

Re-set the env var when done.

- [ ] **Step 5: Final build + lint + test pass**

Run, in parallel if you like:
- `bun run build`
- `bun run lint`
- `bun test`

Expected: all three clean. Report any failures rather than silencing them.

- [ ] **Step 6: Push**

```bash
git pull --rebase
git push
git status   # must show "up to date with origin"
```

Per project CLAUDE.md: work is not complete until `git push` succeeds.
