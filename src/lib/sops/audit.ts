// src/lib/sops/audit.ts
// Pure helpers for rendering audit log entries as human-readable summaries.
// Used by the audit table component and (potentially) future exports.

import type { SopAudience, SopAuditLogEntry } from "@/types/sops";

export function audienceLabel(audience: SopAudience): string {
  return audience === "shared" ? "Shared" : "Management only";
}

export function buildAuditSummary(entry: SopAuditLogEntry): string {
  switch (entry.action) {
    case "upload":
      return `Uploaded ${entry.newFilename ?? "(unknown)"} (${audienceLabel(entry.audienceAtAction)})`;

    case "replace_file":
      return `Replaced ${entry.supersededFilename ?? "(unknown)"} with ${entry.newFilename ?? "(unknown)"}`;

    case "edit_metadata": {
      const parts: string[] = [];
      if (entry.prevTitle !== null && entry.prevTitle !== entry.titleAtAction) {
        parts.push(`Title: "${entry.prevTitle}" → "${entry.titleAtAction}"`);
      }
      const prevDesc = entry.prevDescription ?? "";
      const nextDesc = entry.nextDescription ?? "";
      if (prevDesc !== nextDesc) {
        parts.push(parts.length === 0 ? "Description updated" : "description updated");
      }
      return parts.join("; ") || "Metadata edited";
    }

    case "visibility_change":
      return `Audience: ${audienceLabel(entry.prevAudience ?? entry.audienceAtAction)} → ${audienceLabel(entry.audienceAtAction)}`;

    case "delete":
      return `Deleted ${entry.supersededFilename ?? "(unknown)"}`;
  }
}
