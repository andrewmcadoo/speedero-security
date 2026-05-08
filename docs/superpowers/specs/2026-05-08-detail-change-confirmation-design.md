# Detail-Change Confirmation + Manager Notification — Design Spec

**Date:** 2026-05-08
**Status:** Approved, ready for implementation plan
**Owner:** AJ

## Problem

`DetailDropdown` (`src/components/detail-dropdown.tsx`) currently saves a new detail level the moment a manager picks an option in the `<select>`. There is no confirmation step, and the rest of the management team has no idea the change happened until they next refresh the dashboard.

Two related issues:

1. **No confirmation.** A mis-tap or stray click silently mutates the day's detail level, with no chance to back out.
2. **No notification.** When a manager bumps a day from `single` → `dual` (or removes detail entirely), other managers don't find out unless someone tells them or they happen to look at that date.

## Goals

- Require an explicit confirmation step before a detail-level change is saved.
- By default, notify all other managers by email when a detail level changes — including the date, the new level, and the schedule entry for that date.
- Let the acting manager opt out of the email per-change with a single checkbox.
- Keep the email a best-effort side-effect: a Resend hiccup must not block the actual schedule change.

## Non-goals

- No per-manager opt-out preferences (no new settings UI). The toggle is per-change only.
- No notifications for any other action (EPO assignment, travel legs, transitions, etc.). Only `setDetailLevel`.
- No HTML email design system. The email body uses simple inline-styled HTML plus a plain-text alternative — both generated from the same builder.
- No app-wide toast system. Errors surface inline beneath the dropdown.
- The existing `setDetailLevel` action stays exported for any non-UI callers (tests, future server jobs). The UI switches to a new wrapping action.

## User-facing flow

1. A manager picks a new value in `DetailDropdown`. The select's pending value updates locally; **nothing saves yet**.
2. A `<DetailChangeDialog>` opens with the message:
   > Change detail for **{Mon DD YYYY}** from **{old label}** to **{new label}**?
3. Below the message, a checkbox: **"Notify other managers by email"** — checked by default.
4. Buttons: **Cancel** and **Confirm**.
5. **Cancel** closes the dialog and reverts the dropdown to the previously-saved value. No server call.
6. **Confirm** triggers a single server action that saves the change, then (if the box is checked) fans out emails. The dialog shows a small spinner on the Confirm button until the action resolves (save + optional email step). The email step is awaited but treated as best-effort (see error handling).
7. On save success, the dialog closes. If the email step reported a failure, an inline message appears beneath the dropdown for ~5 seconds: "Detail saved. Email notification failed."
8. On save failure, the dialog closes, the dropdown reverts, and the inline message shows the server error.

## Scope — which detail changes trigger the dialog

| Old → New | Dialog? | Email default? |
|---|---|---|
| `none` → `single` / `dual_day` / `dual` | Yes | On |
| any non-`none` → any other non-`none` | Yes | On |
| any non-`none` → `none` | Yes | On |
| same value re-selected | No (browser `onChange` doesn't fire) | — |

The "→ none" case is included intentionally: removing detail is significant news for the rest of the management team.

## Components & files

### Modified: `src/components/detail-dropdown.tsx`

- Adds `pendingValue: DetailLevel | null` and `inlineError: string | null` to local state.
- `onChange` no longer awaits a server call; it sets `pendingValue` and opens the dialog.
- `onConfirm` calls the new server action; on success, sets `value`. On failure, reverts and shows the error.
- `onCancel` closes the dialog without changing `value`.
- Renders the new `<DetailChangeDialog>` and an inline `<p role="alert">` for errors.

### New: `src/components/detail-change-dialog.tsx`

```ts
interface DetailChangeDialogProps {
  open: boolean;
  date: string;                  // YYYY-MM-DD
  oldLevel: DetailLevel;
  newLevel: DetailLevel;
  notifyDefault?: boolean;       // default: true
  onConfirm: (notify: boolean) => void;
  onCancel: () => void;
}
```

- Renders `null` when `open === false` (matches `confirm-dialog.tsx` and `edit-user-modal.tsx`).
- Presentational: same dark-modal layout as `ConfirmDialog`.
- Owns its own `notify` checkbox state, initialized from `notifyDefault`.
- Confirm button is disabled while `loading` is true (driven by parent via `pendingValue` after click — implementation detail; the dialog accepts an optional `loading?: boolean` to drive button disabled state).
- Escape key cancels; backdrop click cancels (mirrors `ConfirmDialog`).
- Not a generalization of `ConfirmDialog`; that component stays focused on its current shape. This dialog has the extra checkbox and a fixed two-line "from → to" body.

### Modified: `src/app/dashboard/actions.ts`

New server action:

```ts
export async function setDetailLevelWithNotify(
  date: string,
  level: DetailLevel,
  notify: boolean,
): Promise<ActionResult & { emailError?: string }>
```

- Reuses `withGuard` (past-date guard, signed-in check) and the existing `_setDetailLevelForTest` save logic.
- After the save:
  - If `notify === false` or no other managers exist: return `{ ok: true }`.
  - Otherwise: load actor's `fullName`, the schedule entry for `date`, the previous detail level (read once before the upsert so the email can show old → new), and other managers' emails. Build the email payload and call the Resend wrapper with `Promise.allSettled` over recipients.
  - If any recipient rejects or the wrapper throws: return `{ ok: true, emailError: "..." }`. The save still succeeds.
- The existing `setDetailLevel` action stays as-is for tests and any non-UI callers.
- A test seam `_setDetailLevelWithNotifyForTest(date, level, notify, factory, now, deps)` mirrors the existing `_…ForTest` pattern, where `deps` injects the email-send and profile/schedule lookups.

### New: `src/lib/email/resend.ts`

```ts
export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void>
```

- Reads `RESEND_API_KEY` and `RESEND_FROM_ADDRESS` from `process.env`.
- Throws a descriptive `Error` if either env var is missing (the action catches and surfaces as `emailError: "Email not configured"`).
- Thin wrapper around the official `resend` npm SDK. Adds `resend` as a runtime dependency.

### New: `src/lib/email/detail-change-notification.ts`

```ts
export function buildDetailChangeEmail(args: {
  date: string;                  // YYYY-MM-DD
  oldLevel: DetailLevel;
  newLevel: DetailLevel;
  scheduleEntry: ScheduleEntry | null;
  changedByName: string;
  appUrl: string;                // from env, e.g. "https://secapp.speedero.com"
}): { subject: string; html: string; text: string }
```

- Pure function (no I/O). Both `html` and `text` are generated from the same source data so they stay in sync.
- Subject: `Detail changed for {YYYY-MM-DD}: {newLevelLabel}`.
- Body includes the changed-by name, formatted date, old and new level, schedule entry fields (destination / location / time / status), and a `{appUrl}/dashboard?date={date}` deep link.
- If `scheduleEntry` is null, the schedule block reads "No schedule entry for this date."

### Not modified: `src/lib/supabase/queries.ts`

The action reads `profiles` directly via the supabase client (matching the existing `_setDetailLevelForTest` pattern), so no new query helpers are introduced. If a second caller appears later, lifting the queries into `queries.ts` is straightforward.

## Email content

**Subject:** `Detail changed for {YYYY-MM-DD}: {newLevelLabel}`

**Plain-text body:**

```
Hi,

{Changed-by name} updated the detail level for {weekday, Mon DD YYYY}.

  New detail: {newLevelLabel}
  Previous:   {oldLevelLabel}

Schedule for that day:
  Activity:     {scheduleEntry.activity or "—"}
  Location:     {scheduleEntry.location or "—"}
  Departure:    {departure.airport} {departure.fbo} @ {departure.time}
  Arrival:      {arrival.airport} {arrival.fbo} @ {arrival.time}
  Confirmation: {scheduleEntry.confirmationStatus}
  Teak Night:   {yes / no}

Open dashboard: {appUrl}/dashboard?date={YYYY-MM-DD}

— Speedero Security
```

Empty fields render as `—`. If a departure/arrival sub-object has no airport/fbo/time, the whole line collapses to `—`. The schedule entry comes from `fetchAllLiveSourcesCached(supabase, today).schedule`, filtered to `date`.

**HTML body:** the same content rendered in a single dark-on-light card with inline styles. No external assets.

When `scheduleEntry` is null, the entire "Schedule for that day:" block is replaced with a single line: "No schedule entry for this date."

## Error handling & edge cases

| Case | Behavior |
|---|---|
| Same value re-selected | Browser `onChange` does not fire. No dialog. |
| User cancels dialog | Dropdown reverts. No server call. No email. |
| Save fails (Supabase error / past-date guard / not signed in) | Dialog closes. Dropdown reverts. Inline error shows the server message. **No email.** |
| Save succeeds, email checkbox off | Dialog closes silently. No email. |
| Save succeeds, email checkbox on, all sends succeed | Dialog closes silently. |
| Save succeeds, email send fails (any reason) | Dialog closes. Inline error: "Detail saved. Email notification failed." Full Resend error logged via `console.error` server-side. |
| No other managers exist | Skip Resend entirely. Treated as success. |
| `RESEND_API_KEY` or `RESEND_FROM_ADDRESS` missing | Save still succeeds. `emailError = "Email not configured"`. Surfaced same as a send failure. |
| Resend partial failure (some recipients OK, some not) | Per-recipient `Promise.allSettled`. Successful sends go out. If any rejection, `emailError = "Some notifications failed (N of M)"`. |
| Schedule entry lookup fails | Treat as `null` and proceed; the email shows "No schedule entry for this date." Save is unaffected. |

## Testing

The repo uses `bun test` with hand-rolled Supabase stubs (see `src/app/dashboard/actions.test.ts`). New tests follow that pattern.

| Test | Verifies |
|---|---|
| `src/lib/email/detail-change-notification.test.ts` | `buildDetailChangeEmail` produces correct subject/text/HTML for: typical entry, missing entry, each detail level, the `→ none` case, and that the date renders in the expected format. Pure-function tests, no mocks. |
| `src/app/dashboard/actions.test.ts` (additions) | `_setDetailLevelWithNotifyForTest` covers: notify=false skips email; notify=true calls email sender once per recipient; recipients exclude the actor and non-managers; save failure short-circuits before email; email failure does not roll back save and is returned as `emailError`; missing env returns `"Email not configured"`. |
| `src/lib/supabase/queries.test.ts` (or inline in actions test if no separate file) | `getOtherManagerEmails` returns only `role = 'management'` profiles, excludes the actor. |
| `src/components/detail-change-dialog.test.tsx` (if a component test harness is set up; otherwise manual) | Optional — covered by manual verification if no harness exists. |
| Manual verification | AJ runs `bun run dev`, exercises the dropdown end-to-end with a real Resend test address, confirms dialog appears, checkbox defaults checked, save + email succeed, save + email-failure surfaces inline. Per project rule, AJ verifies before push. |

`src/lib/email/resend.ts` is intentionally not unit-tested — it's a thin SDK wrapper, exercised via integration.

## Configuration

Two new environment variables:

- `RESEND_API_KEY` — Resend project API key.
- `RESEND_FROM_ADDRESS` — verified sender address (e.g. `Speedero Security <noreply@speedero.com>`).

Plus one read from the existing config (or new if not present):

- `NEXT_PUBLIC_APP_URL` — base URL for the deep link in the email. If absent, the email omits the link line.

## Dependencies

- Add `resend` to `package.json` runtime deps. No other new dependencies.

## Open items for implementation

- The action reads the actor's name and other managers' emails inline against `profiles`. No new query helpers are needed.
- Schedule entries come from `fetchAllLiveSourcesCached(supabase, today).schedule`, filtered to `date`. Cache hits keep this cheap.
- `ScheduleEntry` field names verified against `src/types/schedule.ts` (see Email content section).
- Confirm sender domain verification status with Resend before first send.
