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
  // Initialize notify from notifyDefault. The parent should pass a `key` prop
  // tied to notifyDefault (or open state) to reset this state on re-open.
  const [notify, setNotify] = useState<boolean>(notifyDefault);

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
