# Teak Inline Read-Only View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make saved Teak leg details visible inline in `TeakToggle` (manager view) via an expandable read-only panel, without requiring the user to click Edit first. Add a Cancel button to the edit form.

**Architecture:** Add an optional `footer` slot prop to the existing `TravelDetailsSection` (already used for read-only display on the EPO side) and reuse it inside `TeakToggle`. Render the panel whenever a `travel_leg` exists and the edit form is closed; the footer carries the Edit button. The edit form gains a sibling Cancel button that resets local field state and closes the form without a network call.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, Supabase JS client. Package manager: `bun`.

**Spec:** `docs/superpowers/specs/2026-04-20-teak-inline-readonly-view-design.md`

## Project Conventions — read before coding

- **No test framework in `src/`.** The project's `package.json` declares `"test": "bun test"` but contains zero application tests; all existing features are verified manually. The spec's "Testing" section lists manual scenarios. **Do not scaffold a test framework for this work** — it's out of scope. Automated safety net is `bun tsc --noEmit` and `bun run lint`, plus the manual scenarios in Task 5.
- **`bun` is the package manager.** Never substitute `npm` or `yarn`.
- **Commits are file-scoped.** Stage files individually (`git add path/to/file`); do **not** use `git add .` or `git add -A`.
- **Read-only visual baseline** is `src/components/travel-details-section.tsx` (used by the EPO-facing `schedule-detail-card.tsx`). The manager reuse must not change the EPO side's rendering.
- **Next.js 16 is not the Next.js you know** (per `AGENTS.md`). This plan does not require any Next-version-specific APIs, but if you reach for one, check `node_modules/next/dist/docs/` first.

## File Structure

- **Modify:** `src/components/travel-details-section.tsx` — add an optional `footer?: React.ReactNode` prop rendered inside `<details>` below the field rows. Purely additive; existing EPO callsite is unaffected.
- **Modify:** `src/components/teak-toggle.tsx` —
  - Remove the top-right "Edit" link from the TEAK header row.
  - When a leg exists and the form is closed, render `<TravelDetailsSection>` with an Edit button passed as `footer`.
  - Add a Cancel button next to Save in the edit form, with a handler that resets `fields` to the current `leg` values and closes the form.

No other files change. No type changes. No new files. No schema, server-action, or query changes.

---

## Task 1: Add optional `footer` prop to `TravelDetailsSection`

**Files:**
- Modify: `src/components/travel-details-section.tsx`

Rationale: Smallest, most isolated change. The prop is purely additive; the EPO-side callsite in `schedule-detail-card.tsx` does not pass it, so its rendering is byte-identical. Doing this first means Task 3 can consume the new prop.

- [ ] **Step 1.1: Replace the file contents**

Replace the entire contents of `src/components/travel-details-section.tsx` with:

```tsx
import type { ReactNode } from "react";
import type { TravelLeg } from "@/types/schedule";

const labelClass = "text-[10px] text-gray-500 mb-0.5";
const valueClass = "text-xs text-gray-100";

function display(value: string): string {
  return value === "" ? "—" : value;
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

export function TravelDetailsSection({
  leg,
  footer,
}: {
  leg: TravelLeg;
  footer?: ReactNode;
}) {
  return (
    <details className="group rounded-md border-t border-gray-700/50 bg-gray-950/50 px-2.5 py-2">
      <summary className="flex cursor-pointer list-none items-center justify-between text-[10px] font-medium uppercase text-teal-400">
        <span>{leg.action === "Pick up" ? "Teak Pick Up" : "Teak Drop Off"}</span>
        <span className="text-gray-500 transition-transform group-open:rotate-90">
          ▶
        </span>
      </summary>
      <div className="mt-2 space-y-1.5">
        <Row label="Location" value={display(leg.location)} />
        <Row label="Time" value={display(leg.time)} />
        <Row label="Companion" value={display(leg.companion)} />
        <Row label="Companion Pre-Position" value={display(leg.companionPrePositionFlight)} />
        <Row label="Teak Flight" value={display(leg.teakFlight)} />
        <Row label="Companion Return" value={display(leg.companionReturnFlight)} />
      </div>
      {footer && <div className="mt-2 flex justify-end">{footer}</div>}
    </details>
  );
}
```

- [ ] **Step 1.2: Typecheck**

Run: `bun tsc --noEmit`
Expected: no errors. The `ReactNode` import comes from `react`, and the existing EPO callsite in `schedule-detail-card.tsx:142` (`<TravelDetailsSection leg={entry.travelLeg} />`) still satisfies the new prop shape because `footer` is optional.

- [ ] **Step 1.3: Lint**

Run: `bun run lint`
Expected: no errors or warnings for `src/components/travel-details-section.tsx`.

- [ ] **Step 1.4: Commit**

```bash
git add src/components/travel-details-section.tsx
git commit -m "feat(travel-details): add optional footer slot"
```

---

## Task 2: Remove the top-right "Edit" link from `TeakToggle` header

**Files:**
- Modify: `src/components/teak-toggle.tsx`

Rationale: Small isolated structural change. Doing it before Task 3 keeps each diff focused. After this task the UI temporarily has no way to reopen the form for an existing leg from the collapsed state — Task 3 restores that path via the footer Edit button inside the new read-only panel. Do Tasks 2 and 3 back-to-back; do not ship Task 2 alone.

- [ ] **Step 2.1: Simplify the TEAK header row**

In `src/components/teak-toggle.tsx`, locate this block (currently around lines 254–264):

```tsx
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] text-gray-500">TEAK</span>
        {leg && !formOpen && (
          <button
            onClick={() => setFormOpen(true)}
            className="text-[10px] text-teal-400 hover:text-teal-300"
          >
            Edit
          </button>
        )}
      </div>
```

Replace it with:

```tsx
      <div className="mb-1.5">
        <span className="text-[10px] text-gray-500">TEAK</span>
      </div>
```

- [ ] **Step 2.2: Typecheck**

Run: `bun tsc --noEmit`
Expected: no errors. No props or state are removed.

- [ ] **Step 2.3: Lint**

Run: `bun run lint`
Expected: no errors or warnings for `src/components/teak-toggle.tsx`. (Unused-variable warnings are not expected because `setFormOpen` is still used by the existing form `onSave`/`onCancel` paths and will be used again in Task 3.)

- [ ] **Step 2.4: Do NOT commit yet**

Task 3 modifies the same file and the two changes belong in a single logical step ("read-only panel replaces the old Edit link"). Committing now would leave an intermediate state on `main` where an existing leg is visually unreachable from the collapsed state.

---

## Task 3: Render read-only panel with Edit footer when leg exists and form is closed

**Files:**
- Modify: `src/components/teak-toggle.tsx`

- [ ] **Step 3.1: Import `TravelDetailsSection`**

In `src/components/teak-toggle.tsx`, add this import alongside the existing imports at the top of the file (the existing imports end at line 7 with `import { ConfirmDialog } from "./confirm-dialog";`):

```tsx
import { TravelDetailsSection } from "./travel-details-section";
```

- [ ] **Step 3.2: Insert the read-only panel**

Locate the block that renders the editable form (currently starting at `{leg && formOpen && (` around line 301). Immediately **before** that block, insert:

```tsx
      {leg && !formOpen && (
        <div className="mt-2">
          <TravelDetailsSection
            leg={leg}
            footer={
              <button
                onClick={() => setFormOpen(true)}
                className="text-[10px] text-teal-400 hover:text-teal-300"
              >
                Edit
              </button>
            }
          />
        </div>
      )}
```

The two conditional blocks (`{leg && !formOpen && ...}` and `{leg && formOpen && ...}`) are mutually exclusive by construction, so exactly one renders at a time when `leg` exists.

- [ ] **Step 3.3: Typecheck**

Run: `bun tsc --noEmit`
Expected: no errors.

- [ ] **Step 3.4: Lint**

Run: `bun run lint`
Expected: no errors or warnings.

- [ ] **Step 3.5: Smoke-test in the dev server**

Run: `bun run dev`
In the manager dashboard:
1. Pick a date with no Teak leg. Tap **Pick Up**. Fill in Location = "JFK Terminal 4", Time = "3:00pm". Click **Save**.
   - Expected: form closes. Below the toggle buttons a bordered panel reads "Teak Pick Up ▶".
2. Click the "Teak Pick Up ▶" summary.
   - Expected: caret rotates, six rows appear — Location "JFK Terminal 4", Time "3:00pm", the remaining four show "—". An "Edit" link appears at the bottom-right of the panel.
3. Click the **Edit** link.
   - Expected: the read-only panel disappears, the edit form reappears with Location and Time prefilled.
4. Stop the dev server (Ctrl-C).

- [ ] **Step 3.6: Commit Tasks 2 and 3 together**

```bash
git add src/components/teak-toggle.tsx
git commit -m "feat(teak): show read-only details inline, edit moves into panel"
```

---

## Task 4: Add Cancel button and handler to the edit form

**Files:**
- Modify: `src/components/teak-toggle.tsx`

- [ ] **Step 4.1: Add `handleCancel`**

In `src/components/teak-toggle.tsx`, immediately after the `handleSave` function (which ends at the closing brace of its `async` body, currently around line 217), add this function:

```tsx
  function handleCancel() {
    if (!leg) return;
    setFields(toFieldState(leg));
    setFormOpen(false);
  }
```

This resets the in-progress field values back to what's persisted on `leg` and closes the form. No network call — purely local state.

- [ ] **Step 4.2: Replace the Save button with a Save + Cancel row**

Locate the existing Save button inside the `formOpen` block (currently around lines 311–317):

```tsx
          <button
            onClick={handleSave}
            disabled={saving}
            className="mt-1 w-full rounded bg-teal-700 px-3 py-1.5 text-xs font-medium text-teal-100 transition-colors hover:bg-teal-600 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
```

Replace it with:

```tsx
          <div className="mt-1 flex gap-2">
            <button
              onClick={handleCancel}
              disabled={saving}
              className="shrink-0 rounded border border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:border-gray-500 hover:text-gray-200 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 rounded bg-teal-700 px-3 py-1.5 text-xs font-medium text-teal-100 transition-colors hover:bg-teal-600 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
```

Notes:
- Save keeps `flex-1` so it remains the dominant primary action.
- Cancel uses `shrink-0` and a muted neutral style, matching the un-selected toggle-button aesthetic elsewhere in this component (`border border-gray-600 text-gray-500 hover:...` family) without overloading any semantic color.
- Both respect `disabled={saving}` so a Cancel mid-save can't race the Supabase update.

- [ ] **Step 4.3: Typecheck**

Run: `bun tsc --noEmit`
Expected: no errors.

- [ ] **Step 4.4: Lint**

Run: `bun run lint`
Expected: no errors or warnings.

- [ ] **Step 4.5: Smoke-test Cancel**

Run: `bun run dev`
In the manager dashboard, using the date you set up in Task 3:
1. Expand the "Teak Pick Up" panel and click **Edit**.
   - Expected: form appears with Location and Time prefilled.
2. Change Location to "Something else". Do NOT click Save.
3. Click **Cancel**.
   - Expected: form closes immediately (no network activity in devtools Network tab), read-only panel reappears collapsed.
4. Expand the panel.
   - Expected: Location still reads "JFK Terminal 4" — the change was discarded.
5. Stop the dev server.

- [ ] **Step 4.6: Commit**

```bash
git add src/components/teak-toggle.tsx
git commit -m "feat(teak): add Cancel button to edit form"
```

---

## Task 5: Full manual verification pass

**Files:** none changed — this is the acceptance checklist from the spec, run end-to-end against the built-up behavior.

- [ ] **Step 5.1: Start the dev server**

Run: `bun run dev`
Log in as a manager and navigate to a management card.

- [ ] **Step 5.2: Run every scenario from the spec**

Walk through each numbered step in the **Testing** section of `docs/superpowers/specs/2026-04-20-teak-inline-readonly-view-design.md`:

1. Fresh date → Pick Up → Save → collapsed "Teak Pick Up ▶" panel appears.
2. Expand → six rows, two filled, four as "—", Edit visible.
3. Edit → form reappears prefilled.
4. Change a field → Cancel → discarded, panel reappears, original value intact.
5. Edit → change → Save → new value shown.
6. Tap Drop Off (switch) → confirm dialog → summary text becomes "Teak Drop Off", fields persist.
7. Tap Drop Off again (unset) → confirm dialog → panel disappears entirely.
8. Collapse the card, re-expand it → `<details>` is present and collapsed by default.

For each scenario, mark pass/fail in your notes.

- [ ] **Step 5.3: Confirm the EPO side is unchanged**

Log out and log in as an EPO (or switch to an EPO-scoped page that uses `schedule-detail-card.tsx`). View a date with a Teak leg.
Expected: the existing "Teak Pick Up" / "Teak Drop Off" read-only panel renders exactly as before — no footer, no Edit button, same styling. This verifies the optional `footer` prop didn't regress the EPO-facing view.

- [ ] **Step 5.4: Final typecheck + lint**

Run:
```bash
bun tsc --noEmit
bun run lint
```
Expected: both clean.

- [ ] **Step 5.5: Stop the dev server**

Ctrl-C.

---

## Rollback

If a later regression requires reverting, the change spans three commits across two files. `git revert` the two `feat(teak): …` commits and the `feat(travel-details): add optional footer slot` commit in reverse order. No migrations, no data changes, no external dependencies to undo.
