"use client";

import { useEffect, useState } from "react";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | { kind: "success" };

export function ReportBugButton() {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    if (status.kind !== "success") return;
    const timer = setTimeout(() => {
      setOpen(false);
      setDescription("");
      setStatus({ kind: "idle" });
    }, 1500);
    return () => clearTimeout(timer);
  }, [status]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (description.trim().length === 0) return;
    setStatus({ kind: "submitting" });
    try {
      const response = await fetch("/api/bugs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
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
    } catch {
      setStatus({ kind: "error", message: "Network error — try again" });
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-3 rounded-lg bg-gray-800 p-4 shadow-lg"
      >
        <div>
          <h2 className="text-sm font-semibold text-gray-100">Report a bug</h2>
          <p className="text-xs text-gray-400">
            Describe what went wrong. We&apos;ll include your email and the page
            you were on.
          </p>
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          maxLength={5000}
          required
          autoFocus
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
            onClick={() => {
              setOpen(false);
              setStatus({ kind: "idle" });
            }}
            className="rounded-lg px-4 py-2 text-sm text-gray-400 transition-colors hover:text-gray-200"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
