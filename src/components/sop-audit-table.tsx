// src/components/sop-audit-table.tsx
"use client";

import Link from "next/link";
import type { SopAuditAction, SopAuditLogEntryWithActor } from "@/types/sops";
import { buildAuditSummary } from "@/lib/sops/audit";

const ACTION_BADGE: Record<SopAuditAction, string> = {
  upload: "bg-emerald-900/60 text-emerald-200",
  replace_file: "bg-blue-900/60 text-blue-200",
  edit_metadata: "bg-gray-800 text-gray-300",
  visibility_change: "bg-amber-900/60 text-amber-200",
  delete: "bg-red-900/60 text-red-200",
};

const ACTION_LABEL: Record<SopAuditAction, string> = {
  upload: "Upload",
  replace_file: "Replace",
  edit_metadata: "Edit",
  visibility_change: "Visibility",
  delete: "Delete",
};

interface Props {
  entries: SopAuditLogEntryWithActor[];
  signedUrlByPath: Record<string, string | null>;
}

export function SopAuditTable({ entries, signedUrlByPath }: Props) {
  if (entries.length === 0) {
    return (
      <p className="rounded-lg border border-gray-800 bg-gray-900 p-6 text-center text-sm text-gray-400">
        No audit entries match these filters.
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-950 text-xs uppercase text-gray-400">
          <tr>
            <th className="px-3 py-2">Time</th>
            <th className="px-3 py-2">Actor</th>
            <th className="px-3 py-2">Action</th>
            <th className="px-3 py-2">SOP</th>
            <th className="px-3 py-2">Summary</th>
            <th className="px-3 py-2 text-right">File</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800 text-gray-200">
          {entries.map((e) => {
            const filePath = e.newStoragePath ?? e.supersededStoragePath;
            const url = filePath ? signedUrlByPath[filePath] : null;
            return (
              <tr key={e.id}>
                <td className="px-3 py-2 align-top text-xs text-gray-400">
                  {new Date(e.occurredAt).toLocaleString()}
                </td>
                <td className="px-3 py-2 align-top text-xs">
                  <span title={e.actorEmailAtAction}>
                    {e.actorFullNameAtAction || e.actorEmailAtAction || "Deleted user"}
                  </span>
                </td>
                <td className="px-3 py-2 align-top">
                  <span
                    className={`inline-block rounded px-2 py-0.5 text-[10px] uppercase ${ACTION_BADGE[e.action]}`}
                  >
                    {ACTION_LABEL[e.action]}
                  </span>
                </td>
                <td className="px-3 py-2 align-top">
                  <Link
                    href={`/sops/audit?sop_id=${e.sopId}`}
                    className="text-blue-300 hover:text-blue-200"
                  >
                    {e.titleAtAction}
                  </Link>
                </td>
                <td className="px-3 py-2 align-top text-gray-300">
                  {buildAuditSummary(e)}
                </td>
                <td className="px-3 py-2 align-top text-right">
                  {url ? (
                    <a
                      href={url}
                      className="text-xs text-blue-300 hover:text-blue-200"
                    >
                      Download
                    </a>
                  ) : (
                    <span className="text-xs text-gray-600">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
