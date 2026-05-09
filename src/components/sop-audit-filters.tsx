// src/components/sop-audit-filters.tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import type { SopAuditAction } from "@/types/sops";

const ALL_ACTIONS: { value: SopAuditAction; label: string }[] = [
  { value: "upload", label: "Upload" },
  { value: "replace_file", label: "Replace" },
  { value: "edit_metadata", label: "Edit metadata" },
  { value: "visibility_change", label: "Visibility change" },
  { value: "delete", label: "Delete" },
];

interface Props {
  managementProfiles: { id: string; full_name: string | null }[];
}

export function SopAuditFilters({ managementProfiles }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [titleQuery, setTitleQuery] = useState(params?.get("q") ?? "");
  const [actorId, setActorId] = useState(params?.get("actor") ?? "");
  const [startDate, setStartDate] = useState(params?.get("start") ?? "");
  const [endDate, setEndDate] = useState(params?.get("end") ?? "");
  const [actions, setActions] = useState<Set<SopAuditAction>>(
    new Set((params?.get("actions") ?? "").split(",").filter(Boolean) as SopAuditAction[])
  );

  function apply() {
    const next = new URLSearchParams();
    if (titleQuery) next.set("q", titleQuery);
    if (actorId) next.set("actor", actorId);
    if (startDate) next.set("start", startDate);
    if (endDate) next.set("end", endDate);
    if (actions.size > 0) next.set("actions", Array.from(actions).join(","));
    const sopId = params?.get("sop_id");
    if (sopId) next.set("sop_id", sopId);
    startTransition(() => {
      router.push(`/sops/audit?${next.toString()}`);
    });
  }

  function reset() {
    setTitleQuery("");
    setActorId("");
    setStartDate("");
    setEndDate("");
    setActions(new Set());
    startTransition(() => router.push("/sops/audit"));
  }

  function toggleAction(a: SopAuditAction) {
    const next = new Set(actions);
    if (next.has(a)) next.delete(a);
    else next.add(a);
    setActions(next);
  }

  return (
    <div className="space-y-3 rounded-lg border border-gray-800 bg-gray-900 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs text-gray-400">
          Title contains
          <input
            value={titleQuery}
            onChange={(e) => setTitleQuery(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-800 bg-gray-950 px-2 py-1 text-sm text-gray-100"
          />
        </label>
        <label className="text-xs text-gray-400">
          Actor
          <select
            value={actorId}
            onChange={(e) => setActorId(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-800 bg-gray-950 px-2 py-1 text-sm text-gray-100"
          >
            <option value="">Any</option>
            {managementProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name ?? p.id}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-400">
          From
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-800 bg-gray-950 px-2 py-1 text-sm text-gray-100"
          />
        </label>
        <label className="text-xs text-gray-400">
          To
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-800 bg-gray-950 px-2 py-1 text-sm text-gray-100"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {ALL_ACTIONS.map((a) => (
          <button
            key={a.value}
            type="button"
            onClick={() => toggleAction(a.value)}
            className={
              actions.has(a.value)
                ? "rounded-full bg-blue-900/60 px-3 py-1 text-xs text-blue-100"
                : "rounded-full border border-gray-800 px-3 py-1 text-xs text-gray-400 hover:text-gray-100"
            }
          >
            {a.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={apply}
          disabled={pending}
          className="rounded-md bg-blue-700 px-3 py-1.5 text-sm text-blue-50 hover:bg-blue-600"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={pending}
          className="rounded-md px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
