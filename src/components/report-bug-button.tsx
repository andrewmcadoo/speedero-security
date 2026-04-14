"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DESCRIPTION_MAX } from "@/lib/bugs/format-issue";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | { kind: "success" };

export function ReportBugButton() {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLFormElement>(null);

  const close = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setOpen(false);
    setDescription("");
    setStatus({ kind: "idle" });
  }, []);

  // Auto-close 1.5s after success.
  useEffect(() => {
    if (status.kind !== "success") return;
    const timer = setTimeout(close, 1500);
    return () => clearTimeout(timer);
  }, [status.kind, close]);

  // Focus, escape, and focus-trap wiring while the modal is open.
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    textareaRef.current?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        "textarea, button:not([disabled])"
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previousFocusRef.current?.focus();
    };
  }, [open, close]);

  // Abort any in-flight request if the component unmounts.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (description.trim().length === 0) {
      setStatus({ kind: "error", message: "Please describe the bug." });
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus({ kind: "submitting" });
    try {
      // basePath is not auto-prefixed on browser fetch; read it from env so this
      // works both on Clipper (basePath="/SecApp") and any other host.
      const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
      const response = await fetch(`${basePath}/api/bugs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
        signal: controller.signal,
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !data.ok) {
        setStatus({
          kind: "error",
          message: data.error ?? "Could not send the report",
        });
        return;
      }
      setStatus({ kind: "success" });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setStatus({ kind: "error", message: "Network error — try again" });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md px-3 py-1.5 text-xs text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
      >
        Report Bug
      </button>
    );
  }

  const pending = status.kind === "submitting";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <form
        ref={dialogRef}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-bug-title"
        className="w-full max-w-md space-y-3 rounded-lg bg-gray-800 p-4 shadow-lg"
      >
        <div>
          <h2
            id="report-bug-title"
            className="text-sm font-semibold text-gray-100"
          >
            Report a bug
          </h2>
          <p className="text-xs text-gray-400">
            Describe what went wrong. We&apos;ll include your email and the page
            you were on.
          </p>
        </div>
        <textarea
          ref={textareaRef}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          maxLength={DESCRIPTION_MAX}
          required
          placeholder="What went wrong?"
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
        />
        {status.kind === "error" && (
          <p className="text-xs text-red-400">{status.message}</p>
        )}
        {status.kind === "success" && (
          <p className="text-xs text-green-400">Sent — thanks!</p>
        )}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending || status.kind === "success"}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {pending ? "Sending..." : "Submit"}
          </button>
          <button
            type="button"
            onClick={close}
            className="rounded-lg px-4 py-2 text-sm text-gray-400 transition-colors hover:text-gray-200"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
