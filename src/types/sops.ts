// src/types/sops.ts
// Domain types for the SOPs feature. Database row shapes are converted
// to these types by query helpers in src/lib/supabase/queries.ts.

export type SopAudience = "shared" | "management_only";

export type SopFileType = "pdf" | "docx";

export interface Sop {
  id: string;
  title: string;
  description: string | null;
  audience: SopAudience;
  storagePathPdf: string;
  storagePathOriginal: string;
  originalFilename: string;
  originalMimeType: string;
  fileSizeBytes: number;
  uploadedBy: string;
  uploadedAt: string;
  updatedAt: string;
}

export type SopAuditAction =
  | "upload"
  | "replace_file"
  | "edit_metadata"
  | "visibility_change"
  | "delete";

export interface SopAuditLogEntry {
  id: string;
  occurredAt: string;
  actorId: string;
  sopId: string;
  action: SopAuditAction;
  titleAtAction: string;
  audienceAtAction: SopAudience;

  newStoragePath: string | null;
  newFilename: string | null;
  newMimeType: string | null;
  newFileSizeBytes: number | null;

  supersededStoragePath: string | null;
  supersededFilename: string | null;

  prevTitle: string | null;
  prevDescription: string | null;
  nextDescription: string | null;
  prevAudience: SopAudience | null;
}

// View-model variant including the actor's display name, used by the audit
// table component so it doesn't have to re-resolve names per row.
export interface SopAuditLogEntryWithActor extends SopAuditLogEntry {
  actorFullName: string;
  actorEmail: string;
}

export const PDF_MIME = "application/pdf";
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const MAX_SOP_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

export function fileTypeFromMime(mime: string): SopFileType | null {
  if (mime === PDF_MIME) return "pdf";
  if (mime === DOCX_MIME) return "docx";
  return null;
}
