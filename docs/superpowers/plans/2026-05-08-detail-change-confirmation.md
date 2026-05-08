# Detail-Change Confirmation + Manager Notification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a confirmation dialog with a "notify other managers by email" checkbox before saving a new detail level for a date, and (when checked) email all other managers via Resend with the date, new level, previous level, and that day's schedule entry.

**Architecture:** A new server action `setDetailLevelWithNotify` wraps the existing `_setDetailLevelForTest` save logic, then conditionally builds and sends emails. Email content comes from a pure builder. Recipients are fetched from `profiles` (role = `management`, excluding the actor). The schedule entry is read from the existing live-source cache. Save is the primary action and always succeeds independently of email; email failure is surfaced as `emailError` and rendered inline beneath the dropdown.

**Tech Stack:** Next.js 16 App Router (server actions), TypeScript, Supabase (server client), Resend (new dep), `bun test`, Tailwind CSS, React 19.

**Spec:** `docs/superpowers/specs/2026-05-08-detail-change-confirmation-design.md`

---

## File map

**New:**
- `src/lib/email/resend.ts` — Thin Resend SDK wrapper (no tests; integration only)
- `src/lib/email/detail-change-notification.ts` — Pure email builder
- `src/lib/email/detail-change-notification.test.ts` — Builder tests
- `src/components/detail-change-dialog.tsx` — Confirmation dialog with notify checkbox

**Modified:**
- `package.json` — Add `resend` runtime dep
- `src/app/dashboard/actions.ts` — Add `_setDetailLevelWithNotifyForTest` and `setDetailLevelWithNotify`
- `src/app/dashboard/actions.test.ts` — Add tests for the new action
- `src/components/detail-dropdown.tsx` — Use the dialog and the new action

The action reads `profiles` directly via the supabase client — same pattern as the existing `_setDetailLevelForTest` — so no new query helpers are needed.

---

## Task 1: Add `resend` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install resend**

Run:
```bash
bun add resend
```

Expected: `package.json` and `bun.lock` updated. Resend version pinned in `dependencies`.

- [ ] **Step 2: Verify install**

Run:
```bash
grep '"resend"' package.json
```

Expected: A line like `"resend": "^4.x.x"` (or whichever current major).

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore(deps): add resend for transactional email"
```

---

## Task 2: Create the Resend wrapper

**Files:**
- Create: `src/lib/email/resend.ts`

This wrapper is intentionally untested — it's a thin shim over the Resend SDK and is exercised via integration. All policy/branching lives in the action and the email builder.

- [ ] **Step 1: Create the wrapper**

Create `src/lib/email/resend.ts`:

```ts
import { Resend } from "resend";

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email not configured");
    this.name = "EmailNotConfiguredError";
  }
}

export async function sendEmail(args: SendEmailArgs): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_ADDRESS;
  if (!apiKey || !from) {
    throw new EmailNotConfiguredError();
  }
  const resend = new Resend(apiKey);
  const result = await resend.emails.send({
    from,
    to: args.to,
    subject: args.subject,
    html: args.html,
    text: args.text,
  });
  if (result.error) {
    throw new Error(`Resend send failed: ${result.error.message}`);
  }
}
```

- [ ] **Step 2: Verify it type-checks**

Run:
```bash
bun run lint
```

Expected: No errors in `src/lib/email/resend.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/email/resend.ts
git commit -m "feat(email): add Resend SDK wrapper"
```

---

## Task 3: Build the email body — failing test

**Files:**
- Create: `src/lib/email/detail-change-notification.test.ts`

The builder is a pure function: in (date, oldLevel, newLevel, scheduleEntry, changedByName, appUrl), out (subject, html, text). Tests should cover: typical entry; missing entry; → none; → from none; departure/arrival sub-objects with missing pieces; no appUrl; subject format; HTML and text both contain key fields.

- [ ] **Step 1: Write the test file**

Create `src/lib/email/detail-change-notification.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { buildDetailChangeEmail } from "./detail-change-notification";
import type { ScheduleEntry } from "@/types/schedule";

const sampleEntry: ScheduleEntry = {
  date: "2026-05-12",
  dayOfWeek: "Tuesday",
  confirmationStatus: "confirmed",
  teakNight: false,
  activity: "Site visit — Reno",
  location: "Reno, NV",
  coPilot: "",
  flightInfo: "",
  departure: { airport: "KVNY", fbo: "Signature", time: "08:30" },
  arrival: { airport: "KRNO", fbo: "Atlantic", time: "10:15" },
  internationalPax: "",
  groundTransport: "",
  lodging: "",
  comments: "",
  rowId: "row-12",
};

describe("buildDetailChangeEmail", () => {
  test("subject includes date and new level label", () => {
    const result = buildDetailChangeEmail({
      date: "2026-05-12",
      oldLevel: "single",
      newLevel: "dual",
      scheduleEntry: sampleEntry,
      changedByName: "Jane Manager",
      appUrl: "https://secapp.speedero.com",
    });
    expect(result.subject).toBe("Detail changed for 2026-05-12: Dual");
  });

  test("text body includes changed-by name, both levels, and schedule fields", () => {
    const result = buildDetailChangeEmail({
      date: "2026-05-12",
      oldLevel: "single",
      newLevel: "dual_day",
      scheduleEntry: sampleEntry,
      changedByName: "Jane Manager",
      appUrl: "https://secapp.speedero.com",
    });
    expect(result.text).toContain("Jane Manager");
    expect(result.text).toContain("New detail: Dual (Day Only)");
    expect(result.text).toContain("Previous:   Single");
    expect(result.text).toContain("Site visit — Reno");
    expect(result.text).toContain("Reno, NV");
    expect(result.text).toContain("KVNY Signature @ 08:30");
    expect(result.text).toContain("KRNO Atlantic @ 10:15");
    expect(result.text).toContain("Confirmation: confirmed");
    expect(result.text).toContain("Teak Night:   no");
    expect(result.text).toContain(
      "https://secapp.speedero.com/dashboard?date=2026-05-12"
    );
  });

  test("html body contains the same key facts as text body", () => {
    const result = buildDetailChangeEmail({
      date: "2026-05-12",
      oldLevel: "none",
      newLevel: "single",
      scheduleEntry: sampleEntry,
      changedByName: "Jane Manager",
      appUrl: "https://secapp.speedero.com",
    });
    expect(result.html).toContain("Jane Manager");
    expect(result.html).toContain("Single");
    expect(result.html).toContain("None");
    expect(result.html).toContain("Site visit — Reno");
    expect(result.html).toContain("KVNY");
    expect(result.html).toContain(
      "https://secapp.speedero.com/dashboard?date=2026-05-12"
    );
  });

  test("missing schedule entry collapses to a single line", () => {
    const result = buildDetailChangeEmail({
      date: "2026-05-12",
      oldLevel: "single",
      newLevel: "dual",
      scheduleEntry: null,
      changedByName: "Jane Manager",
      appUrl: "https://secapp.speedero.com",
    });
    expect(result.text).toContain("No schedule entry for this date.");
    expect(result.text).not.toContain("Activity:");
    expect(result.html).toContain("No schedule entry for this date.");
  });

  test("blank schedule fields render as em-dash", () => {
    const blank: ScheduleEntry = {
      ...sampleEntry,
      activity: "",
      location: "",
      departure: { airport: "", fbo: "", time: "" },
      arrival: { airport: "", fbo: "", time: "" },
    };
    const result = buildDetailChangeEmail({
      date: "2026-05-12",
      oldLevel: "single",
      newLevel: "dual",
      scheduleEntry: blank,
      changedByName: "Jane Manager",
      appUrl: "https://secapp.speedero.com",
    });
    expect(result.text).toContain("Activity:     —");
    expect(result.text).toContain("Location:     —");
    expect(result.text).toContain("Departure:    —");
    expect(result.text).toContain("Arrival:      —");
  });

  test("teak night true renders 'yes'", () => {
    const result = buildDetailChangeEmail({
      date: "2026-05-12",
      oldLevel: "single",
      newLevel: "dual",
      scheduleEntry: { ...sampleEntry, teakNight: true },
      changedByName: "Jane Manager",
      appUrl: "https://secapp.speedero.com",
    });
    expect(result.text).toContain("Teak Night:   yes");
  });

  test("change to none uses None label", () => {
    const result = buildDetailChangeEmail({
      date: "2026-05-12",
      oldLevel: "dual",
      newLevel: "none",
      scheduleEntry: sampleEntry,
      changedByName: "Jane Manager",
      appUrl: "https://secapp.speedero.com",
    });
    expect(result.subject).toBe("Detail changed for 2026-05-12: None");
    expect(result.text).toContain("New detail: None");
    expect(result.text).toContain("Previous:   Dual");
  });

  test("empty appUrl omits the dashboard link line", () => {
    const result = buildDetailChangeEmail({
      date: "2026-05-12",
      oldLevel: "single",
      newLevel: "dual",
      scheduleEntry: sampleEntry,
      changedByName: "Jane Manager",
      appUrl: "",
    });
    expect(result.text).not.toContain("Open dashboard");
    expect(result.html).not.toContain("Open dashboard");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:
```bash
bun test src/lib/email/detail-change-notification.test.ts
```

Expected: All tests fail with "Cannot find module './detail-change-notification'" (or similar).

---

## Task 4: Build the email body — implementation

**Files:**
- Create: `src/lib/email/detail-change-notification.ts`

- [ ] **Step 1: Write the builder**

Create `src/lib/email/detail-change-notification.ts`:

```ts
import type { DetailLevel, ScheduleEntry } from "@/types/schedule";
import { DETAIL_LEVEL_LABELS } from "@/lib/detail-levels";

export interface BuildDetailChangeEmailArgs {
  date: string;                  // YYYY-MM-DD
  oldLevel: DetailLevel;
  newLevel: DetailLevel;
  scheduleEntry: ScheduleEntry | null;
  changedByName: string;
  appUrl: string;                // empty string allowed; omits the link line
}

export interface DetailChangeEmail {
  subject: string;
  html: string;
  text: string;
}

const DASH = "—";

function or(value: string): string {
  return value && value.trim().length > 0 ? value : DASH;
}

function locationLine(part: { airport: string; fbo: string; time: string }): string {
  const a = part.airport.trim();
  const f = part.fbo.trim();
  const t = part.time.trim();
  if (!a && !f && !t) return DASH;
  return `${or(a)} ${or(f)} @ ${or(t)}`;
}

function formatHumanDate(date: string): string {
  // Render YYYY-MM-DD as "Weekday, Mon DD YYYY" using UTC math (no host TZ drift).
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  }).format(dt);
}

export function buildDetailChangeEmail(
  args: BuildDetailChangeEmailArgs
): DetailChangeEmail {
  const { date, oldLevel, newLevel, scheduleEntry, changedByName, appUrl } =
    args;
  const newLabel = DETAIL_LEVEL_LABELS[newLevel];
  const oldLabel = DETAIL_LEVEL_LABELS[oldLevel];
  const human = formatHumanDate(date);

  const subject = `Detail changed for ${date}: ${newLabel}`;

  const linkLine = appUrl
    ? `\nOpen dashboard: ${appUrl}/dashboard?date=${date}\n`
    : "";

  const scheduleBlock = scheduleEntry
    ? [
        "Schedule for that day:",
        `  Activity:     ${or(scheduleEntry.activity)}`,
        `  Location:     ${or(scheduleEntry.location)}`,
        `  Departure:    ${locationLine(scheduleEntry.departure)}`,
        `  Arrival:      ${locationLine(scheduleEntry.arrival)}`,
        `  Confirmation: ${scheduleEntry.confirmationStatus}`,
        `  Teak Night:   ${scheduleEntry.teakNight ? "yes" : "no"}`,
      ].join("\n")
    : "No schedule entry for this date.";

  const text = [
    "Hi,",
    "",
    `${changedByName} updated the detail level for ${human}.`,
    "",
    `  New detail: ${newLabel}`,
    `  Previous:   ${oldLabel}`,
    "",
    scheduleBlock,
    linkLine,
    "— Speedero Security",
  ].join("\n");

  const escapeHtml = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const scheduleHtml = scheduleEntry
    ? `
      <p style="margin:16px 0 8px 0;font-weight:600;">Schedule for that day</p>
      <table style="border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:2px 12px 2px 0;color:#555;">Activity</td><td>${escapeHtml(or(scheduleEntry.activity))}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#555;">Location</td><td>${escapeHtml(or(scheduleEntry.location))}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#555;">Departure</td><td>${escapeHtml(locationLine(scheduleEntry.departure))}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#555;">Arrival</td><td>${escapeHtml(locationLine(scheduleEntry.arrival))}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#555;">Confirmation</td><td>${escapeHtml(scheduleEntry.confirmationStatus)}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#555;">Teak Night</td><td>${scheduleEntry.teakNight ? "yes" : "no"}</td></tr>
      </table>
    `
    : `<p style="margin:16px 0;color:#555;">No schedule entry for this date.</p>`;

  const linkHtml = appUrl
    ? `<p style="margin:16px 0;"><a href="${appUrl}/dashboard?date=${date}">Open dashboard</a></p>`
    : "";

  const html = `<!doctype html>
<html>
<body style="font-family:system-ui,-apple-system,sans-serif;color:#111;background:#fafafa;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:20px;">
    <p style="margin:0 0 12px 0;">Hi,</p>
    <p style="margin:0 0 16px 0;">${escapeHtml(changedByName)} updated the detail level for <strong>${escapeHtml(human)}</strong>.</p>
    <p style="margin:0;"><strong>New detail:</strong> ${escapeHtml(newLabel)}</p>
    <p style="margin:4px 0 0 0;color:#555;">Previous: ${escapeHtml(oldLabel)}</p>
    ${scheduleHtml}
    ${linkHtml}
    <p style="margin:24px 0 0 0;color:#888;font-size:12px;">— Speedero Security</p>
  </div>
</body>
</html>`;

  return { subject, html, text };
}
```

- [ ] **Step 2: Run the tests and verify they pass**

Run:
```bash
bun test src/lib/email/detail-change-notification.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/email/detail-change-notification.ts src/lib/email/detail-change-notification.test.ts
git commit -m "feat(email): add detail-change notification builder"
```

---

## Task 5: New action `_setDetailLevelWithNotifyForTest` — failing tests

**Files:**
- Modify: `src/app/dashboard/actions.test.ts`

The action is a tested seam; the public `setDetailLevelWithNotify` will be a thin wrapper added in Task 8. Tests exercise: notify=false skips email; notify=true calls send once per recipient; recipients exclude the actor and non-managers (provided by the supabase mock); save failure short-circuits before email; email failure is reported via `emailError` without rolling back save; missing config (`EmailNotConfiguredError`) reports `"Email not configured"`.

- [ ] **Step 1: Append the test cases**

Append the following block to `src/app/dashboard/actions.test.ts` (at the bottom of the file). Adjust the existing top-of-file import to also pull `_setDetailLevelWithNotifyForTest` once the action file exports it.

First, update the imports at the top of the file:

```ts
import {
  _assignEpoForTest,
  _setDetailLevelForTest,
  _setDetailLevelWithNotifyForTest,
  _unassignEpoForTest,
  _createTravelLegForTest,
  _updateTravelLegForTest,
  _deleteTravelLegForTest,
} from "./actions";
```

Then append at the bottom of the file:

```ts
import type { ScheduleEntry } from "@/types/schedule";
import { EmailNotConfiguredError } from "@/lib/email/resend";

const sampleEntry: ScheduleEntry = {
  date: "2026-04-28",
  dayOfWeek: "Tuesday",
  confirmationStatus: "confirmed",
  teakNight: false,
  activity: "Site visit",
  location: "Reno, NV",
  coPilot: "",
  flightInfo: "",
  departure: { airport: "KVNY", fbo: "Signature", time: "08:30" },
  arrival: { airport: "KRNO", fbo: "Atlantic", time: "10:15" },
  internationalPax: "",
  groundTransport: "",
  lodging: "",
  comments: "",
  rowId: "row-1",
};

interface NotifyMockState {
  upsertedRows: Record<string, unknown>[];
  selectedDates: string[];
  previousLevel: string | null;
  actorRow: { id: string; full_name: string; email: string } | null;
  otherManagers: { id: string; full_name: string; email: string }[];
}

function makeNotifyFactory(state: NotifyMockState) {
  return () => ({
    auth: { getUser: async () => ({ data: { user: { id: "mgr-uuid" } } }) },
    from: (table: string) => {
      if (table === "date_settings") {
        return {
          insert: async () => ({ error: null }),
          upsert: async (row: Record<string, unknown>) => {
            state.upsertedRows.push(row);
            return { error: null };
          },
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: async () => {
                state.selectedDates.push(val);
                return state.previousLevel
                  ? { data: { detail_level: state.previousLevel }, error: null }
                  : { data: null, error: null };
              },
            }),
          }),
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: (col1: string, val1: string) => {
              if (col1 === "id") {
                return {
                  maybeSingle: async () =>
                    state.actorRow
                      ? { data: state.actorRow, error: null }
                      : { data: null, error: null },
                };
              }
              return {
                neq: (_col2: string, _val2: string) => ({
                  data: state.otherManagers,
                  error: null,
                }),
              };
            },
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  });
}

describe("setDetailLevelWithNotify", () => {
  const originalTz = process.env.APP_TIMEZONE;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = originalTz;
  });

  test("notify=false saves without sending email", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    const state: NotifyMockState = {
      upsertedRows: [],
      selectedDates: [],
      previousLevel: "single",
      actorRow: null,
      otherManagers: [],
    };
    let sendCalls = 0;
    const result = await _setDetailLevelWithNotifyForTest(
      "2026-04-28",
      "dual",
      false,
      makeNotifyFactory(state),
      now,
      {
        sendEmail: async () => {
          sendCalls++;
        },
        loadSchedule: async () => [sampleEntry],
        appUrl: "https://test.example",
      }
    );
    expect(result).toEqual({ ok: true });
    expect(state.upsertedRows.length).toBe(1);
    expect(sendCalls).toBe(0);
  });

  test("notify=true sends one email per other manager", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    const state: NotifyMockState = {
      upsertedRows: [],
      selectedDates: [],
      previousLevel: "single",
      actorRow: { id: "mgr-uuid", full_name: "Jane Manager", email: "jane@x" },
      otherManagers: [
        { id: "m2", full_name: "Bob", email: "bob@x" },
        { id: "m3", full_name: "Carol", email: "carol@x" },
      ],
    };
    const sentTo: string[] = [];
    const result = await _setDetailLevelWithNotifyForTest(
      "2026-04-28",
      "dual",
      true,
      makeNotifyFactory(state),
      now,
      {
        sendEmail: async (args) => {
          sentTo.push(args.to);
        },
        loadSchedule: async () => [sampleEntry],
        appUrl: "https://test.example",
      }
    );
    expect(result).toEqual({ ok: true });
    expect(sentTo.sort()).toEqual(["bob@x", "carol@x"]);
  });

  test("save failure short-circuits before email", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    let sendCalls = 0;
    const factory = () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: "mgr-uuid" } } }),
      },
      from: (table: string) => {
        if (table === "date_settings") {
          return {
            insert: async () => ({ error: null }),
            upsert: async () => ({ error: { message: "db down" } }),
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      },
    });
    const result = await _setDetailLevelWithNotifyForTest(
      "2026-04-28",
      "dual",
      true,
      factory,
      now,
      {
        sendEmail: async () => {
          sendCalls++;
        },
        loadSchedule: async () => [sampleEntry],
        appUrl: "https://test.example",
      }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("db down");
    expect(sendCalls).toBe(0);
  });

  test("email send failure does not roll back save", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    const state: NotifyMockState = {
      upsertedRows: [],
      selectedDates: [],
      previousLevel: "none",
      actorRow: { id: "mgr-uuid", full_name: "Jane", email: "jane@x" },
      otherManagers: [
        { id: "m2", full_name: "Bob", email: "bob@x" },
        { id: "m3", full_name: "Carol", email: "carol@x" },
      ],
    };
    const result = await _setDetailLevelWithNotifyForTest(
      "2026-04-28",
      "single",
      true,
      makeNotifyFactory(state),
      now,
      {
        sendEmail: async (args) => {
          if (args.to === "carol@x") throw new Error("smtp 500");
        },
        loadSchedule: async () => [sampleEntry],
        appUrl: "https://test.example",
      }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.emailError).toBe("Some notifications failed (1 of 2)");
    }
    expect(state.upsertedRows.length).toBe(1);
  });

  test("missing email config returns 'Email not configured'", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    const state: NotifyMockState = {
      upsertedRows: [],
      selectedDates: [],
      previousLevel: "single",
      actorRow: { id: "mgr-uuid", full_name: "Jane", email: "jane@x" },
      otherManagers: [{ id: "m2", full_name: "Bob", email: "bob@x" }],
    };
    const result = await _setDetailLevelWithNotifyForTest(
      "2026-04-28",
      "dual",
      true,
      makeNotifyFactory(state),
      now,
      {
        sendEmail: async () => {
          throw new EmailNotConfiguredError();
        },
        loadSchedule: async () => [sampleEntry],
        appUrl: "https://test.example",
      }
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.emailError).toBe("Email not configured");
  });

  test("no other managers — save succeeds, no email attempt", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    const state: NotifyMockState = {
      upsertedRows: [],
      selectedDates: [],
      previousLevel: "single",
      actorRow: { id: "mgr-uuid", full_name: "Jane", email: "jane@x" },
      otherManagers: [],
    };
    let sendCalls = 0;
    const result = await _setDetailLevelWithNotifyForTest(
      "2026-04-28",
      "dual",
      true,
      makeNotifyFactory(state),
      now,
      {
        sendEmail: async () => {
          sendCalls++;
        },
        loadSchedule: async () => [sampleEntry],
        appUrl: "https://test.example",
      }
    );
    expect(result).toEqual({ ok: true });
    expect(sendCalls).toBe(0);
  });

  test("missing schedule entry still sends with null entry", async () => {
    process.env.APP_TIMEZONE = "America/Los_Angeles";
    const now = new Date("2026-04-28T15:00:00Z");
    const state: NotifyMockState = {
      upsertedRows: [],
      selectedDates: [],
      previousLevel: "single",
      actorRow: { id: "mgr-uuid", full_name: "Jane", email: "jane@x" },
      otherManagers: [{ id: "m2", full_name: "Bob", email: "bob@x" }],
    };
    let sentSubject = "";
    const result = await _setDetailLevelWithNotifyForTest(
      "2026-04-28",
      "dual",
      true,
      makeNotifyFactory(state),
      now,
      {
        sendEmail: async (args) => {
          sentSubject = args.subject;
        },
        loadSchedule: async () => [], // no entry for this date
        appUrl: "https://test.example",
      }
    );
    expect(result).toEqual({ ok: true });
    expect(sentSubject).toContain("2026-04-28");
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:
```bash
bun test src/app/dashboard/actions.test.ts
```

Expected: New `setDetailLevelWithNotify` describe block fails to compile / load because `_setDetailLevelWithNotifyForTest` and `EmailNotConfiguredError` don't yet exist. The pre-existing tests should still pass (Resend wrapper and email builder are already in place).

If the import for `EmailNotConfiguredError` fails the whole file, that's fine — Task 2 created that export, so the import will resolve once `_setDetailLevelWithNotifyForTest` is added in Task 6.

---

## Task 6: Implement `_setDetailLevelWithNotifyForTest`

**Files:**
- Modify: `src/app/dashboard/actions.ts`

- [ ] **Step 1: Add the imports at the top of the file**

In `src/app/dashboard/actions.ts`, extend the existing imports:

```ts
import { createClient } from "@/lib/supabase/server";
import { assertNotPast, PastDateWriteError } from "@/lib/access-control";
import { invalidateLiveSourcesCache, fetchAllLiveSourcesCached } from "@/lib/snapshot/live-cache";
import { revalidatePath } from "next/cache";
import type { DetailLevel, ScheduleEntry } from "@/types/schedule";
import { buildDetailChangeEmail } from "@/lib/email/detail-change-notification";
import { sendEmail, EmailNotConfiguredError, type SendEmailArgs } from "@/lib/email/resend";
import { getAnchorDates } from "@/lib/schedule-utils";
```

- [ ] **Step 2: Extend the `SupabaseLike` type**

The new action reads `date_settings` (select), reads `profiles` (select with `eq` and with `eq + neq`). The hand-rolled mock in tests already supplies these surfaces. Update the type to declare them. Replace the existing `SupabaseLike` with:

```ts
type SupabaseLike = {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
    delete?: () => unknown;
    update?: (row: Record<string, unknown>) => unknown;
    upsert?: (row: Record<string, unknown>, opts?: unknown) => Promise<{ error: { message: string } | null }>;
    select?: (columns?: string) => {
      eq: (col: string, val: string) => {
        maybeSingle?: () => Promise<{ data: unknown; error: { message: string } | null }>;
        neq?: (col2: string, val2: string) => Promise<{ data: unknown; error: { message: string } | null }> | { data: unknown; error: { message: string } | null };
      };
    };
  };
};
```

(Other actions don't use `select`, so the optional `?` keeps them happy.)

- [ ] **Step 3: Add the action and its dependency interface**

Append to `src/app/dashboard/actions.ts` immediately after the existing `setDetailLevel` export (before the `// ---- travel-leg actions ----` divider):

```ts
// ---- setDetailLevelWithNotify ----

export interface SetDetailLevelWithNotifyDeps {
  sendEmail: (args: SendEmailArgs) => Promise<void>;
  loadSchedule: (supabase: SupabaseLike, today: string) => Promise<ScheduleEntry[]>;
  appUrl: string;
}

type SetDetailLevelWithNotifyResult =
  | { ok: true; emailError?: string }
  | { ok: false; error: string };

export async function _setDetailLevelWithNotifyForTest(
  date: string,
  level: DetailLevel,
  notify: boolean,
  factory: SupabaseFactory,
  now: Date,
  deps: SetDetailLevelWithNotifyDeps
): Promise<SetDetailLevelWithNotifyResult> {
  return withGuard(date, now, async (supabase, userId): Promise<SetDetailLevelWithNotifyResult> => {
    // Read previous detail level so the email can show old → new.
    const previousLevelRow = await supabase
      .from("date_settings")
      .select?.("detail_level")
      .eq("date", date)
      .maybeSingle?.();
    const previousLevel: DetailLevel = (() => {
      const data = previousLevelRow?.data as { detail_level?: DetailLevel } | null;
      return data?.detail_level ?? "none";
    })();

    // Save (same as setDetailLevel).
    const upsertResult = await supabase.from("date_settings").upsert!(
      {
        date,
        detail_level: level,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "date" }
    );
    if (upsertResult.error) return { ok: false, error: upsertResult.error.message };

    if (!notify) return { ok: true };

    // Look up actor name and other managers.
    const actorRow = await supabase
      .from("profiles")
      .select?.("id, full_name, email")
      .eq("id", userId)
      .maybeSingle?.();
    const actorName =
      ((actorRow?.data as { full_name?: string | null } | null)?.full_name ?? "")
        .trim() || "A manager";

    const othersResp = await supabase
      .from("profiles")
      .select?.("id, full_name, email")
      .eq("role", "management")
      .neq?.("id", userId);
    const others =
      (othersResp && "data" in othersResp ? othersResp.data : null) as
        | { id: string; full_name: string | null; email: string }[]
        | null;
    const recipients = others ?? [];
    if (recipients.length === 0) return { ok: true };

    // Find the schedule entry for this date.
    const { today } = getAnchorDates(now);
    let scheduleEntry: ScheduleEntry | null = null;
    try {
      const schedule = await deps.loadSchedule(supabase, today);
      scheduleEntry = schedule.find((s) => s.date === date) ?? null;
    } catch (err) {
      console.error("loadSchedule failed for detail-change email:", err);
      scheduleEntry = null;
    }

    const email = buildDetailChangeEmail({
      date,
      oldLevel: previousLevel,
      newLevel: level,
      scheduleEntry,
      changedByName: actorName,
      appUrl: deps.appUrl,
    });

    const settled = await Promise.allSettled(
      recipients.map((r) =>
        deps.sendEmail({
          to: r.email,
          subject: email.subject,
          html: email.html,
          text: email.text,
        })
      )
    );

    const failed = settled.filter((s) => s.status === "rejected");
    if (failed.length === 0) return { ok: true };

    const firstReason = (failed[0] as PromiseRejectedResult).reason;
    if (firstReason instanceof EmailNotConfiguredError) {
      console.error("Resend not configured; detail-change email skipped");
      return { ok: true, emailError: "Email not configured" };
    }
    for (const f of failed) {
      console.error("detail-change email send failed:", (f as PromiseRejectedResult).reason);
    }
    return {
      ok: true,
      emailError: `Some notifications failed (${failed.length} of ${recipients.length})`,
    };
  }, factory);
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run:
```bash
bun test src/app/dashboard/actions.test.ts
```

Expected: All `setDetailLevelWithNotify` tests pass, plus all pre-existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/actions.ts src/app/dashboard/actions.test.ts
git commit -m "feat(actions): add setDetailLevelWithNotify with manager email"
```

---

## Task 7: Public `setDetailLevelWithNotify` wrapper

**Files:**
- Modify: `src/app/dashboard/actions.ts`

- [ ] **Step 1: Append the public wrapper**

After `_setDetailLevelWithNotifyForTest`, add:

```ts
export async function setDetailLevelWithNotify(
  date: string,
  level: DetailLevel,
  notify: boolean
): Promise<SetDetailLevelWithNotifyResult> {
  const factory = async () =>
    (await createClient()) as unknown as SupabaseLike;
  const result = await _setDetailLevelWithNotifyForTest(
    date,
    level,
    notify,
    factory,
    new Date(),
    {
      sendEmail,
      loadSchedule: async (_supabase, today) => {
        const supabase = await createClient();
        const sources = await fetchAllLiveSourcesCached(supabase, today);
        return sources.schedule;
      },
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
    }
  );
  if (result.ok) {
    invalidateLiveSourcesCache();
    revalidatePath("/dashboard");
  }
  return result;
}
```

(The `_supabase` param is intentionally unused — the test seam passes the mock supabase to `loadSchedule`, but the production path uses `createClient` so it can read fresh authenticated credentials. The seam still exercises the call surface.)

- [ ] **Step 2: Verify lint**

Run:
```bash
bun run lint
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/actions.ts
git commit -m "feat(actions): expose setDetailLevelWithNotify public wrapper"
```

---

## Task 8: Build `<DetailChangeDialog>`

**Files:**
- Create: `src/components/detail-change-dialog.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/detail-change-dialog.tsx`:

```tsx
"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { DetailLevel } from "@/types/schedule";
import { DETAIL_LEVEL_LABELS } from "@/lib/detail-levels";

interface DetailChangeDialogProps {
  open: boolean;
  date: string;
  oldLevel: DetailLevel;
  newLevel: DetailLevel;
  notifyDefault?: boolean;
  loading?: boolean;
  onConfirm: (notify: boolean) => void;
  onCancel: () => void;
}

export function DetailChangeDialog({
  open,
  date,
  oldLevel,
  newLevel,
  notifyDefault = true,
  loading = false,
  onConfirm,
  onCancel,
}: DetailChangeDialogProps) {
  const titleId = useId();
  const checkboxId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [notify, setNotify] = useState<boolean>(notifyDefault);

  useEffect(() => {
    if (open) setNotify(notifyDefault);
  }, [open, notifyDefault]);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, loading, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onCancel();
      }}
    >
      <div className="w-full max-w-sm rounded-xl bg-gray-900 p-5 shadow-xl">
        <h2 id={titleId} className="text-base font-semibold text-gray-100">
          Change detail for {date}?
        </h2>
        <p className="mt-2 text-sm text-gray-400">
          From <span className="text-gray-200">{DETAIL_LEVEL_LABELS[oldLevel]}</span>{" "}
          to{" "}
          <span className="text-gray-200">{DETAIL_LEVEL_LABELS[newLevel]}</span>.
        </p>

        <label
          htmlFor={checkboxId}
          className="mt-4 flex items-start gap-2 rounded-md bg-gray-950 p-3 text-sm text-gray-300 cursor-pointer"
        >
          <input
            id={checkboxId}
            type="checkbox"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
            className="mt-0.5"
            disabled={loading}
          />
          <span>Notify other managers by email</span>
        </label>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 rounded-lg py-3 text-sm text-gray-300 transition-colors hover:text-gray-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => onConfirm(notify)}
            disabled={loading}
            className="flex-1 rounded-lg py-3 text-sm font-medium bg-teal-700 hover:bg-teal-600 text-teal-50 transition-colors disabled:opacity-50"
          >
            {loading ? "Saving…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify lint**

Run:
```bash
bun run lint
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/detail-change-dialog.tsx
git commit -m "feat(components): add DetailChangeDialog with notify checkbox"
```

---

## Task 9: Wire `<DetailDropdown>` to use the dialog

**Files:**
- Modify: `src/components/detail-dropdown.tsx`

- [ ] **Step 1: Replace the file**

Replace the entire contents of `src/components/detail-dropdown.tsx` with:

```tsx
"use client";

import { setDetailLevelWithNotify } from "@/app/dashboard/actions";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { DetailLevel } from "@/types/schedule";
import { DETAIL_LEVEL_LABELS } from "@/lib/detail-levels";
import { DetailChangeDialog } from "./detail-change-dialog";

const LEVELS: DetailLevel[] = ["none", "single", "dual_day", "dual"];

export function DetailDropdown({
  date,
  initialValue,
}: {
  date: string;
  initialValue: DetailLevel;
}) {
  const [value, setValue] = useState<DetailLevel>(initialValue);
  const [pending, setPending] = useState<DetailLevel | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  // Auto-clear inline error after 5s.
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(id);
  }, [error]);

  const handleConfirm = async (notify: boolean) => {
    if (pending == null) return;
    setSaving(true);
    setError(null);
    const result = await setDetailLevelWithNotify(date, pending, notify);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      setPending(null);
      return;
    }
    setValue(pending);
    setPending(null);
    if (result.emailError) {
      setError(`Detail saved. ${result.emailError}.`);
    }
    router.refresh();
  };

  return (
    <div className="rounded-md bg-gray-950 px-2.5 py-1.5">
      <div className="text-[10px] text-gray-500 mb-0.5">DETAIL</div>
      <select
        className="w-full rounded bg-gray-950 px-2 py-1 text-xs text-gray-100 border border-gray-700 focus:border-blue-500 focus:outline-none"
        value={value}
        onChange={(e) => setPending(e.target.value as DetailLevel)}
      >
        {LEVELS.map((level) => (
          <option key={level} value={level}>
            {DETAIL_LEVEL_LABELS[level]}
          </option>
        ))}
      </select>
      {error && (
        <p
          role="alert"
          className="mt-1 text-[10px] text-red-400"
        >
          {error}
        </p>
      )}
      <DetailChangeDialog
        open={pending != null}
        date={date}
        oldLevel={value}
        newLevel={pending ?? value}
        loading={saving}
        onConfirm={handleConfirm}
        onCancel={() => {
          if (saving) return;
          setPending(null);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify lint**

Run:
```bash
bun run lint
```

Expected: No errors.

- [ ] **Step 3: Run the full test suite**

Run:
```bash
bun test
```

Expected: All tests pass (no regressions in existing dashboard / live-cache / actions tests; new email-builder + setDetailLevelWithNotify tests pass).

- [ ] **Step 4: Commit**

```bash
git add src/components/detail-dropdown.tsx
git commit -m "feat(detail-dropdown): confirm before save and offer manager email"
```

---

## Task 10: Manual end-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Set required env vars locally**

Add to `.env.local` (do not commit):

```
RESEND_API_KEY=re_xxxxxxxxxxxxxxxx
RESEND_FROM_ADDRESS="Speedero Security <noreply@yourverifieddomain.tld>"
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Use the Resend dashboard's onboarding API key + a verified test domain. Recipients in tests must be addresses you control or addresses Resend has whitelisted on your account.

- [ ] **Step 2: Start the dev server (AJ runs this)**

Per project rule, AJ runs:
```bash
bun run dev
```

Open the dashboard as a `management` user.

- [ ] **Step 3: Verify the happy path**

Pick any non-past date. Change the detail level via the dropdown.

Expected:
- Confirmation dialog opens with: "Change detail for {date}?", "From {old} to {new}.", and a checked "Notify other managers by email" checkbox.
- Cancel: dropdown reverts. No save.
- Confirm with checkbox checked: dialog shows "Saving…", then closes. Dashboard refreshes with the new level. Other managers receive an email with the right subject and body.
- Confirm with checkbox unchecked: same save behavior, no email.

- [ ] **Step 4: Verify error surfaces**

Temporarily blank `RESEND_API_KEY` in `.env.local` and restart dev. Repeat the change with the checkbox checked.

Expected: Save still succeeds; "Detail saved. Email not configured." appears under the dropdown for ~5s, then clears.

Restore the key.

- [ ] **Step 5: Verify the "→ none" case**

Change a day from `single` (or any non-`none`) back to `none`.

Expected: Dialog still appears. Confirming + notify produces an email whose subject is `Detail changed for {date}: None`.

- [ ] **Step 6: Verify the missing-schedule case (optional)**

If you have a date that has no row in the live sheet (rare — typically a far-future date past the sheet horizon), change its detail level. The email's schedule block reads "No schedule entry for this date."

- [ ] **Step 7: Final commit and push (AJ)**

If anything was tweaked during verification:
```bash
git add <specific files>
git commit -m "fix(...): address verification finding"
```

Then per the project's session-completion workflow:
```bash
git pull --rebase
git push
git status
```

Expected final `git status`: "up to date with origin".

---

## Self-review

**Spec coverage:**

- ✅ Confirmation dialog before save → Tasks 8, 9.
- ✅ Notify-other-managers checkbox, default checked → Task 8 (`notifyDefault = true`), Task 9 wires it.
- ✅ Recipients = managers minus actor → Task 6 reads `profiles` via supabase with `eq("role","management").neq("id", userId)`, exercised by mocks in Task 5.
- ✅ Email content: date, new level, previous level, schedule entry, changed-by name → Tasks 3 + 4 (builder), Task 6 (action wires actor + previous level + schedule fetch).
- ✅ Email content uses real `ScheduleEntry` fields (`activity`, `location`, `departure.{airport,fbo,time}`, `arrival.{...}`, `confirmationStatus`, `teakNight`) → Task 4 + Task 3 tests.
- ✅ Save-first, email-best-effort → Task 6 returns `emailError` without rolling back save; Task 5 tests cover this; Task 9 surfaces the error inline for ~5s.
- ✅ Confirm + email on every change including → none → Task 8 dialog has no scope filter; Task 9 always opens dialog on change; Task 4 builder handles `none` label correctly.
- ✅ Dialog blocks during save → Task 8 disables buttons + checkbox while `loading`.
- ✅ No app-wide toast — inline error → Task 9 renders `<p role="alert">` beneath the select.
- ✅ Resend wrapper, `RESEND_API_KEY` / `RESEND_FROM_ADDRESS` env vars, missing-config returns `"Email not configured"` → Tasks 2, 6. Verified in Task 5 tests.
- ✅ No other managers → skip Resend → Task 6 short-circuits when `recipients.length === 0`. Verified in Task 5 tests.
- ✅ Existing `setDetailLevel` action stays exported → Task 6 leaves it untouched.

**Placeholder scan:** No "TBD"/"TODO"/"similar to" placeholders. All code blocks complete. All file paths absolute under the repo root.

**Type consistency:**

- `DetailChangeDialog` props (`open`, `date`, `oldLevel`, `newLevel`, `notifyDefault`, `loading`, `onConfirm`, `onCancel`) match between Task 8's component and Task 9's caller.
- `setDetailLevelWithNotify` return type `{ ok: true; emailError?: string } | { ok: false; error: string }` is consistent across Tasks 6, 7, and 9's `result.ok` / `result.emailError` usage.
- `SendEmailArgs` from Task 2 is the same shape passed in Task 6 and tested in Task 5.
- `EmailNotConfiguredError` exported in Task 2 and imported in Tasks 5 and 6.
- `buildDetailChangeEmail` signature matches across Tasks 3 (test), 4 (impl), and 6 (caller).
- `loadSchedule` injection signature `(supabase, today) => Promise<ScheduleEntry[]>` matches between Task 6's `SetDetailLevelWithNotifyDeps` and Task 7's wrapper, and is exercised by Task 5's mocks.
