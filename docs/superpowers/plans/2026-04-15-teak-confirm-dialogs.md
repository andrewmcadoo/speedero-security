# Teak Confirm Dialogs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add confirmation modals in `teak-toggle.tsx` for unsetting active Pick Up / Drop Off (destructive, deletes saved fields) and for switching between them (neutral, fields kept). Teak Night stays as a one-tap toggle.

**Architecture:** Introduce a reusable `<ConfirmDialog>` client component that mirrors the existing modal-overlay pattern in `edit-user-modal.tsx` plus Escape-key support. Wire it into `TeakToggle` with a `pendingAction` state that routes Pick Up / Drop Off taps through a confirmation gate when there's data to lose or the action is switching.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, Supabase JS client. Package manager: `bun`.

**Spec:** `docs/superpowers/specs/2026-04-15-teak-confirm-dialogs-design.md`

## Project Conventions — read before coding

- **No test framework in `src/`.** The project's `package.json` declares `"test": "bun test"` but contains zero application tests; all existing features are verified manually. The feature spec's "Verification" section explicitly lists manual scenarios. **Do not scaffold a test framework for this work** — it's out of scope and would dwarf the feature. Automated safety net is `bun tsc --noEmit` and `bun run lint`, plus the manual scenarios below.
- **`bun` is the package manager.** Never substitute `npm` or `yarn`.
- **Commits are file-scoped.** Stage files individually (`git add path/to/file`); do **not** use `git add .` or `git add -A`.
- **Modal visual baseline** is `src/components/edit-user-modal.tsx` (dark backdrop, click-outside-to-close, no focus trap). The richer pattern in `report-bug-button.tsx` (focus trap, previous-focus restore) is intentionally out of scope.

## File Structure

- **Create:** `src/components/confirm-dialog.tsx` — reusable modal component. Single responsibility: render an overlay with a title, body, and Cancel/Confirm buttons, plus Escape-to-cancel. No knowledge of Teak or travel legs.
- **Modify:** `src/components/teak-toggle.tsx` — wire the new dialog in behind the Pick Up and Drop Off button taps. Teak Night button and the form inputs are untouched.

No other files change. No types, no queries, no server actions, no migrations.

---

## Task 1: Create `<ConfirmDialog>` component

**Files:**
- Create: `src/components/confirm-dialog.tsx`

- [ ] **Step 1.1: Create the file with exact contents**

Create `src/components/confirm-dialog.tsx` with the following complete contents:

```tsx
"use client";

import { useEffect, useRef } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: "destructive" | "neutral";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  variant = "destructive",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onCancel]);

  if (!open) return null;

  const confirmClass =
    variant === "destructive"
      ? "bg-red-600 hover:bg-red-700 text-white"
      : "bg-teal-700 hover:bg-teal-600 text-teal-50";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-sm rounded-xl bg-gray-900 p-5 shadow-xl">
        <h2
          id="confirm-dialog-title"
          className="text-base font-semibold text-gray-100"
        >
          {title}
        </h2>
        <p className="mt-2 text-sm text-gray-400">{body}</p>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg py-3 text-sm text-gray-300 transition-colors hover:text-gray-100"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={`flex-1 rounded-lg py-3 text-sm font-medium transition-colors ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

Rationale for the choices here (do not remove):
- `role="dialog"` and `aria-modal="true"` are cheap to add and make the overlay announce correctly even without a focus trap.
- `useRef` + `confirmRef.current?.focus()` is used instead of the `autoFocus` JSX prop because React's `autoFocus` is applied only on initial mount of the element, and this button mounts/unmounts as `open` toggles. The ref-based focus runs on every transition from closed to open.
- Cancel is on the left (safer default position per Apple/Material HIGs) and Confirm is on the right. Both are `flex-1` so widths match.

- [ ] **Step 1.2: Type-check**

Run: `bun tsc --noEmit`

Expected: exits with code 0, no new errors. (Pre-existing errors from `src/lib/google-sheets.ts` or elsewhere unrelated to this component are acceptable; ensure none of the new errors reference `confirm-dialog.tsx`.)

- [ ] **Step 1.3: Lint the new file**

Run: `bun run lint`

Expected: no errors or warnings reported against `src/components/confirm-dialog.tsx`.

- [ ] **Step 1.4: Visual smoke test is deferred to Task 2**

There is no consumer of `<ConfirmDialog>` yet, so there is nothing to render on-screen. The component is exercised in Task 2's manual verification.

- [ ] **Step 1.5: Commit**

```bash
git add src/components/confirm-dialog.tsx
git commit -m "feat(ui): add ConfirmDialog component

Reusable overlay modal for confirmations. Mirrors the edit-user-modal
overlay/backdrop pattern and adds Escape-to-cancel plus autofocus on
the confirm button. Destructive and neutral variants supported."
```

---

## Task 2: Wire `<ConfirmDialog>` into `TeakToggle`

**Files:**
- Modify: `src/components/teak-toggle.tsx`

- [ ] **Step 2.1: Add the `ConfirmDialog` import**

Open `src/components/teak-toggle.tsx`. Find the existing import block at the top (currently imports `createClient`, `useRouter`, `useEffect`/`useState`, and `TravelLeg`). Add this import just below the `TravelLeg` import:

```ts
import { ConfirmDialog } from "./confirm-dialog";
```

- [ ] **Step 2.2: Add `PendingAction` type + helpers (outside the component)**

Place these declarations **above** the existing `fieldDefs` constant (around line 15 of the current file), so they sit in module scope and are reusable:

```ts
type PendingAction =
  | { kind: "unset"; action: "Pick up" | "Drop off" }
  | {
      kind: "switch";
      from: "Pick up" | "Drop off";
      to: "Pick up" | "Drop off";
    };

const actionLabel = (a: "Pick up" | "Drop off"): string =>
  a === "Pick up" ? "Pick Up" : "Drop Off";

function legHasAnyField(leg: TravelLeg): boolean {
  return [
    leg.location,
    leg.time,
    leg.companion,
    leg.companionPrePositionFlight,
    leg.teakFlight,
    leg.companionReturnFlight,
  ].some((v) => v.trim() !== "");
}

interface DialogCopy {
  title: string;
  body: string;
  confirmLabel: string;
  variant: "destructive" | "neutral";
}

function dialogCopy(pending: PendingAction): DialogCopy {
  if (pending.kind === "unset") {
    const label = actionLabel(pending.action);
    return {
      title: `Remove ${label}?`,
      body:
        "This will delete the location, time, companion, and flight details you've entered for this date.",
      confirmLabel: `Remove ${label}`,
      variant: "destructive",
    };
  }
  return {
    title: `Change ${actionLabel(pending.from)} to ${actionLabel(pending.to)}?`,
    body: "The location, time, companion, and flight details will be kept.",
    confirmLabel: `Change to ${actionLabel(pending.to)}`,
    variant: "neutral",
  };
}
```

Notes:
- `TravelLeg`'s field types are all `string` (non-nullable) per `src/types/schedule.ts`, so no null-guard is needed inside `legHasAnyField`.
- `dialogCopy` takes a non-null `PendingAction` so TypeScript narrows cleanly inside the `if` branch (unlike `pendingAction?.kind === "unset"` on a possibly-null value, which does not narrow the property access that follows).

- [ ] **Step 2.3: Add `pendingAction` state inside the component**

Inside the `TeakToggle` component, directly below the existing `const [saving, setSaving] = useState(false);` line, add:

```ts
const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
```

- [ ] **Step 2.4: Add the tap-router and confirm/cancel handlers**

Below the existing `handleSave` function (around line 167 in the current file) and above the `isPickUp`/`isDropOff` derived values, add these three functions:

```ts
function onPickUpOrDropOffTap(tapped: "Pick up" | "Drop off") {
  if (saving) return;
  if (!leg) {
    void handleToggle(tapped);
    return;
  }
  if (leg.action === tapped) {
    if (!legHasAnyField(leg)) {
      void handleToggle(tapped);
      return;
    }
    setPendingAction({ kind: "unset", action: tapped });
    return;
  }
  setPendingAction({ kind: "switch", from: leg.action, to: tapped });
}

function confirmPending() {
  if (!pendingAction) return;
  const tapped =
    pendingAction.kind === "unset" ? pendingAction.action : pendingAction.to;
  setPendingAction(null);
  void handleToggle(tapped);
}

function cancelPending() {
  setPendingAction(null);
}
```

- [ ] **Step 2.5: Re-wire the Pick Up and Drop Off button `onClick`s**

In the JSX, locate the two buttons that currently call `handleToggle("Pick up")` and `handleToggle("Drop off")` (the first and second buttons inside the `<div className="flex flex-wrap gap-1.5">` block, lines 186–207 of the current file). Change their `onClick` handlers only:

Before:
```tsx
<button
  onClick={() => handleToggle("Pick up")}
  ...
```

After:
```tsx
<button
  onClick={() => onPickUpOrDropOffTap("Pick up")}
  ...
```

And the same change for the Drop Off button:

Before:
```tsx
<button
  onClick={() => handleToggle("Drop off")}
  ...
```

After:
```tsx
<button
  onClick={() => onPickUpOrDropOffTap("Drop off")}
  ...
```

**Do not touch** the Teak Night button (the third button in that block) or its handler.

- [ ] **Step 2.6: Render the `ConfirmDialog`**

The component's root element is `<div className="border-t border-gray-700 pt-2.5">` (line 173). Find the matching closing `</div>` at the very end of the JSX (line 240 in the current file). Immediately before that closing tag, add the dialog:

```tsx
{pendingAction && (() => {
  const copy = dialogCopy(pendingAction);
  return (
    <ConfirmDialog
      open={true}
      title={copy.title}
      body={copy.body}
      confirmLabel={copy.confirmLabel}
      variant={copy.variant}
      onConfirm={confirmPending}
      onCancel={cancelPending}
    />
  );
})()}
```

Why the IIFE: we need to compute `copy` from the non-null `pendingAction` (TypeScript has narrowed it here thanks to the `pendingAction && ...` guard) and pass its fields as props. An IIFE keeps the narrowing scope tight and avoids hoisting a pre-computed `copy` variable into the render body where it would be recomputed on unrelated re-renders.

- [ ] **Step 2.7: Type-check**

Run: `bun tsc --noEmit`

Expected: exits cleanly, no new errors in `src/components/teak-toggle.tsx`.

- [ ] **Step 2.8: Lint**

Run: `bun run lint`

Expected: no errors or warnings against `src/components/teak-toggle.tsx` or `src/components/confirm-dialog.tsx`.

- [ ] **Step 2.9: Build (final safety net)**

Run: `bun run build`

Expected: Next.js build succeeds. If it fails, fix and re-run before proceeding.

- [ ] **Step 2.10: Hand off to AJ for manual verification**

**Do not push to Clipper until AJ has finished local verification** (see `CLIPPER.md`: "Always let AJ run `bun run dev` and review changes locally before pushing to Clipper and building on the server.").

Ask AJ to run `bun run dev`, log in as a management user, expand a management card for a date that allows travel legs, and walk through the scenarios below.

**Manual verification scenarios** (AJ runs these):

1. **Insert without prompt.** On a date with no travel leg, tap **Pick Up**. Expected: row inserts, form opens, no modal appears.
2. **Silent unset when blank.** From state #1 (form open, all fields blank), tap **Pick Up** again. Expected: row deletes silently, no modal.
3. **Destructive confirm — Cancel.** Insert Pick Up, fill in at least one field (e.g., Location), tap **Save**. Tap **Pick Up** again. Expected: modal with title `Remove Pick Up?`, red confirm button `Remove Pick Up`, body mentioning location/time/companion/flights. Tap **Cancel** or the backdrop. Expected: modal closes, leg and fields remain.
4. **Destructive confirm — Confirm.** Repeat #3 but tap **Remove Pick Up**. Expected: modal closes, leg row is deleted, badges clear on the card header, fields gone.
5. **Drop Off symmetry.** Repeat #3 and #4 with **Drop Off** instead of Pick Up.
6. **Switch — Cancel.** With a saved Pick Up leg (fields filled), tap **Drop Off**. Expected: neutral (teal) modal titled `Change Pick Up to Drop Off?`, body saying fields will be kept, confirm label `Change to Drop Off`. Tap **Cancel**. Expected: leg still shows Pick Up, fields unchanged.
7. **Switch — Confirm.** Repeat #6 but tap **Change to Drop Off**. Expected: badge flips from PICK UP to DROP OFF, all fields (location/time/companion/flights) remain populated.
8. **Pick Up ← Drop Off switch.** Inverse of #6/#7.
9. **Teak Night untouched.** Tap **Teak Night** on and off several times. Expected: no modal ever appears; badge toggles immediately.
10. **Keyboard (desktop).** With the modal open, press **Escape**. Expected: modal closes, no mutation. Press **Enter** with focus on the confirm button (default). Expected: action commits.
11. **Persistence.** After each of #4, #5, #7, #8, refresh the page. Expected: state persisted matches the last confirmed action.
12. **Rollback on failure (optional but recommended).** Temporarily break the Supabase RLS or disconnect the network. With a saved leg, tap Pick Up → confirm Remove. Expected: modal closes, UI optimistically deletes, then rolls back to the previous leg when the write fails; console shows the existing `Delete travel leg failed:` log.

If any scenario fails, fix the issue and re-run. Do not commit until AJ reports all scenarios pass.

- [ ] **Step 2.11: Commit**

```bash
git add src/components/teak-toggle.tsx
git commit -m "feat(teak): confirm destructive and switch actions in TeakToggle

Unsetting an active Pick Up or Drop Off while any field is filled now
opens a destructive confirm dialog describing the data that will be
lost. Switching Pick Up <-> Drop Off opens a neutral confirm dialog
noting the fields will be kept. Empty-leg unset and the Teak Night
toggle remain one-tap."
```

---

## Post-implementation checklist

- [ ] Spec file `docs/superpowers/specs/2026-04-15-teak-confirm-dialogs-design.md` still matches the shipped behavior. If the implementation diverged (e.g., the empty-field heuristic changed), update the spec in a follow-up commit.
- [ ] AJ confirms the dev-server walk-through passed. Only then does AJ push to Clipper per `CLIPPER.md`.
- [ ] No changes were made to files outside `src/components/confirm-dialog.tsx` and `src/components/teak-toggle.tsx`. Run `git diff --stat main..HEAD` (after both commits) to confirm.

## Spec coverage self-check

| Spec section | Task coverage |
|---|---|
| Scope table (7 trigger rows) | Task 2.4 (`onPickUpOrDropOffTap` branches) and Task 2.6 (dialog copy matrix) |
| `<ConfirmDialog>` props & behavior | Task 1.1 |
| Escape key + backdrop click | Task 1.1 (both in the component body) |
| Destructive / neutral variants | Task 1.1 (`confirmClass`), Task 2.6 (`variant` prop) |
| Mobile visuals (max-w-sm, py-3 tap targets) | Task 1.1 (classNames) |
| `TeakToggle` new state | Task 2.3 |
| `TeakToggle` tap-router logic | Task 2.4 |
| Dialog copy table (4 cases) | Task 2.6 |
| Teak Night untouched | Task 2.5 ("Do not touch...") and scenario #9 |
| Optimistic rollback preserved | No code change needed; scenario #12 verifies |
| Double-tap Confirm guarded | Existing `saving` flag still gates `handleToggle`; `onPickUpOrDropOffTap` also checks `saving` (Task 2.4) |
| Verification checklist | Step 2.10 scenarios 1–12 |

All spec sections mapped. No gaps identified.
