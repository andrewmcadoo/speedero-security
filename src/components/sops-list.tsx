// src/components/sops-list.tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import type { Sop, SopAudience } from "@/types/sops";
import { audienceLabel } from "@/lib/sops/audit";

type AudienceFilter = "all" | SopAudience;

interface SopsListProps {
  sops: Sop[];
  isManagement: boolean;
  uploadersById: Record<string, string>; // id → fullName
  onRequestUpload?: () => void;
  onRequestEdit?: (sop: Sop) => void;
  onRequestDelete?: (sop: Sop) => void;
}

export function SopsList({
  sops,
  isManagement,
  uploadersById,
  onRequestUpload,
  onRequestEdit,
  onRequestDelete,
}: SopsListProps) {
  const [audienceFilter, setAudienceFilter] = useState<AudienceFilter>("all");

  const visible = isManagement && audienceFilter !== "all"
    ? sops.filter((s) => s.audience === audienceFilter)
    : sops;

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between gap-2">
        {isManagement ? (
          <AudienceSegmented value={audienceFilter} onChange={setAudienceFilter} />
        ) : (
          <h1 className="text-lg font-semibold text-gray-100">SOPs</h1>
        )}
        {isManagement && (
          <div className="flex items-center gap-2">
            <Link
              href="/sops/audit"
              className="rounded-md px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800"
            >
              Audit log
            </Link>
            <button
              type="button"
              onClick={onRequestUpload}
              className="rounded-md bg-blue-700 px-3 py-1.5 text-sm font-medium text-blue-50 hover:bg-blue-600"
            >
              Upload SOP
            </button>
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-gray-800 bg-gray-900 p-6 text-center text-sm text-gray-400">
          {isManagement
            ? "No SOPs uploaded. Click Upload to add the first one."
            : "No SOPs available yet."}
        </p>
      ) : (
        <ul className="divide-y divide-gray-800 overflow-hidden rounded-lg border border-gray-800 bg-gray-900">
          {visible.map((sop) => (
            <SopRow
              key={sop.id}
              sop={sop}
              isManagement={isManagement}
              uploaderName={uploadersById[sop.uploadedBy] ?? ""}
              onEdit={onRequestEdit}
              onDelete={onRequestDelete}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AudienceSegmented({
  value,
  onChange,
}: {
  value: AudienceFilter;
  onChange: (v: AudienceFilter) => void;
}) {
  const options: { value: AudienceFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "shared", label: "Shared" },
    { value: "management_only", label: "Management only" },
  ];
  return (
    <div className="inline-flex rounded-md border border-gray-800 bg-gray-900 p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={
            value === opt.value
              ? "rounded-sm bg-blue-900/60 px-3 py-1 text-sm text-blue-100"
              : "rounded-sm px-3 py-1 text-sm text-gray-400 hover:text-gray-100"
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function SopRow({
  sop,
  isManagement,
  uploaderName,
  onEdit,
  onDelete,
}: {
  sop: Sop;
  isManagement: boolean;
  uploaderName: string;
  onEdit?: (s: Sop) => void;
  onDelete?: (s: Sop) => void;
}) {
  const updated = new Date(sop.updatedAt).toLocaleDateString();
  return (
    <li className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <Link href={`/sops/${sop.id}`} className="group min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-gray-100 group-hover:text-blue-300">
            {sop.title}
          </span>
          {isManagement && (
            <span
              className={
                sop.audience === "shared"
                  ? "rounded bg-emerald-900/60 px-1.5 py-0.5 text-[10px] uppercase text-emerald-200"
                  : "rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] uppercase text-amber-200"
              }
            >
              {audienceLabel(sop.audience)}
            </span>
          )}
        </div>
        {sop.description && (
          <p className="mt-0.5 truncate text-sm text-gray-400">{sop.description}</p>
        )}
        <p className="mt-1 text-xs text-gray-500">
          {uploaderName ? `${uploaderName} · ` : ""}
          Updated {updated}
        </p>
      </Link>
      {isManagement && (
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => onEdit?.(sop)}
            className="rounded-md px-2 py-1 text-sm text-gray-300 hover:bg-gray-800"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => onDelete?.(sop)}
            className="rounded-md px-2 py-1 text-sm text-red-300 hover:bg-red-900/40"
          >
            Delete
          </button>
        </div>
      )}
    </li>
  );
}
