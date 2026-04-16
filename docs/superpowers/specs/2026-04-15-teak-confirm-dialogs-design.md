# Teak Confirmation Dialogs — Design Spec

**Date:** 2026-04-15
**Status:** Approved, ready for implementation plan
**Owner:** AJ

## Problem

`src/components/teak-toggle.tsx` renders three buttons (Pick Up, Drop Off, Teak Night) that mutate state on a single tap. On mobile — the primary target for this app — a fat-finger tap on an already-active Pick Up or Drop Off button **deletes the entire `travel_legs` row**, including the location, time, companion, and flight fields the manager has filled in. Tapping the opposite button switches the leg's `action` in place (fields are kept), which is also irreversible without re-typing intent.

There is currently no confirmation step for these destructive or intent-changing actions.

## Goals

- Prevent accidental data loss from mis-taps on `Pick Up` / `Drop Off` while a travel leg is active.
- Give the manager enough context in the prompt to decide confidently (what will be lost vs. kept).
- Stay out of the way when there's nothing to lose (empty leg, or the harmless Teak Night toggle).

## Non-goals

- Teak Night button behavior is unchanged — it remains a one-tap toggle.
- No accessibility overhaul of existing modals. The new component matches the current app's modal behavior (backdrop click, no focus trap). A cross-cutting a11y pass can happen later.
- No server-side changes. This is a client-only UX layer on top of the existing optimistic write / rollback logic.

## Scope — which actions trigger a confirmation

| Trigger | Current behavior | New behavior |
|---|---|---|
| Tap Pick Up, no leg exists | Inserts empty leg, opens form | **Unchanged** — no prompt |
| Tap Pick Up while Pick Up active, all fields blank | Deletes leg | **Unchanged** — no prompt (nothing to lose) |
| Tap Pick Up while Pick Up active, any field has data | Deletes leg | **Confirm first** (destructive variant) |
| Tap Drop Off while Drop Off active, all fields blank | Deletes leg | **Unchanged** — no prompt |
| Tap Drop Off while Drop Off active, any field has data | Deletes leg | **Confirm first** (destructive variant) |
| Tap Drop Off while Pick Up active (or reverse) | Switches action, keeps fields | **Confirm first** (neutral variant) |
| Tap Teak Night (on or off) | Toggles boolean | **Unchanged** — no prompt |

"Any field has data" means at least one of `location`, `time`, `companion`, `companionPrePositionFlight`, `teakFlight`, `companionReturnFlight` is a non-empty, non-whitespace string.

## Components

### New: `<ConfirmDialog>`

**File:** `src/components/confirm-dialog.tsx` (client component)

```ts
interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;                    // e.g. "Remove Pick Up"
  cancelLabel?: string;                    // default: "Cancel"
  variant?: "destructive" | "neutral";     // default: "destructive"
  onConfirm: () => void;
  onCancel: () => void;
}
```

**Behavior:**

- Renders `null` when `open === false` (same pattern as `edit-user-modal.tsx`).
- Fixed full-screen overlay: `fixed inset-0 z-50 flex items-center justify-center bg-black/60`.
- Centered card: `w-full max-w-sm rounded-xl bg-gray-900 p-5 shadow-xl`.
- Backdrop click (target === currentTarget) calls `onCancel`.
- `Escape` key calls `onCancel`. Implemented with a `useEffect` that adds a `keydown` listener when `open` is `true` and removes it on cleanup.
- Confirm button auto-focuses on mount so Enter commits (desktop convenience, no-op on mobile).

**Visual:**

- Title: `text-base font-semibold text-gray-100`.
- Body: `text-sm text-gray-400 mt-2`.
- Button row: `mt-5 flex gap-2`. Each button is `py-3` (≥44px tap target) and `flex-1` for even widths.
  - Cancel: `rounded-lg text-sm text-gray-300 hover:text-gray-100`.
  - Confirm, destructive variant: `rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium`.
  - Confirm, neutral variant: `rounded-lg bg-teal-700 hover:bg-teal-600 text-teal-50 text-sm font-medium`.

**Not in scope:** focus trap, `aria-modal`, `role="dialog"` wiring. Matches the existing `edit-user-modal.tsx` baseline.

### Modified: `teak-toggle.tsx`

**New local state:**

```ts
type PendingAction =
  | { kind: "unset"; action: "Pick up" | "Drop off" }
  | { kind: "switch"; from: "Pick up" | "Drop off"; to: "Pick up" | "Drop off" };

const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
```

**New handler** (routes the existing `handleToggle` through a confirmation gate):

```ts
function onPickUpOrDropOffTap(tapped: "Pick up" | "Drop off") {
  if (saving) return;

  // No leg yet → just insert.
  if (!leg) return handleToggle(tapped);

  // Same button tapped (unset).
  if (leg.action === tapped) {
    const hasData = [
      leg.location,
      leg.time,
      leg.companion,
      leg.companionPrePositionFlight,
      leg.teakFlight,
      leg.companionReturnFlight,
    ].some((v) => v && v.trim() !== "");
    if (!hasData) return handleToggle(tapped);
    return setPendingAction({ kind: "unset", action: tapped });
  }

  // Different button tapped while a leg exists → switch.
  return setPendingAction({ kind: "switch", from: leg.action, to: tapped });
}
```

Both the Pick Up and Drop Off buttons change their `onClick` to `() => onPickUpOrDropOffTap("Pick up" | "Drop off")`. The Teak Night button is untouched.

**Confirm / cancel wiring:**

```ts
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

**Dialog copy** (derived from `pendingAction`):

| Case | Title | Body | Confirm label | Variant |
|---|---|---|---|---|
| Unset Pick Up | `Remove Pick Up?` | `This will delete the location, time, companion, and flight details you've entered for this date.` | `Remove Pick Up` | destructive |
| Unset Drop Off | `Remove Drop Off?` | `This will delete the location, time, companion, and flight details you've entered for this date.` | `Remove Drop Off` | destructive |
| Switch → Drop Off | `Change Pick Up to Drop Off?` | `The location, time, companion, and flight details will be kept.` | `Change to Drop Off` | neutral |
| Switch → Pick Up | `Change Drop Off to Pick Up?` | `The location, time, companion, and flight details will be kept.` | `Change to Pick Up` | neutral |

**Unchanged:**

- `handleToggle` (insert / update / delete logic, optimistic update + rollback).
- `handleTeakNightToggle`, `handleSave`.
- Form rendering, field state, Edit button.
- The existing `saving` flag continues to gate in-flight writes.

## Error handling

- Supabase write failures inside `handleToggle` are already handled by optimistic-state rollback (`setLeg(prev)`). The dialog has closed by the time the failure is observed; the user sees the original state restored. No dialog-level error UI is added.
- Double-tap on the Confirm button is a no-op after the first tap because `handleToggle` sets `saving = true` synchronously.
- `pendingAction` is component-local state; it is implicitly discarded if the component unmounts.

## Verification

Manual checks on a real phone and on desktop:

1. Tap Pick Up (no leg) → inserts, no prompt.
2. Tap Pick Up, don't fill fields, tap Pick Up again → silently unsets.
3. Tap Pick Up, save at least one field, tap Pick Up again → destructive modal; Cancel keeps leg; Confirm deletes.
4. Repeat 2–3 with Drop Off.
5. Pick Up active with saved fields → tap Drop Off → neutral modal with "kept" copy; Confirm switches action and retains field values.
6. Drop Off active with saved fields → tap Pick Up → symmetrical to #5.
7. Teak Night button still toggles immediately with no modal.
8. Backdrop tap and `Escape` key both cancel.
9. Refresh the page after each action and confirm persisted state matches expectation.
10. Induce a Supabase failure (e.g., temporarily break the row's RLS) and confirm the UI rolls back cleanly when Confirm is tapped.

## Files touched

- **New:** `src/components/confirm-dialog.tsx`
- **Modified:** `src/components/teak-toggle.tsx`

## Suggested commit breakdown

1. `feat(ui): add ConfirmDialog component`
2. `feat(teak): confirm destructive and switch actions in TeakToggle`
