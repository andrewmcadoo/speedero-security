// src/lib/sops/storage.ts
// Pure helpers for SOP storage paths. No Supabase imports — these run on
// the server (in actions) and are also safe to import from tests.

export const SOPS_BUCKET = "sops";

/**
 * Format a timestamp as a URL-safe slug: YYYYMMDDTHHMMSSZ in UTC.
 * Used as the second path segment so each upload gets a unique folder
 * and replacements never overwrite previous files.
 */
export function buildUploadSlug(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z"
  );
}

export function buildOriginalPath(
  sopId: string,
  uploadSlug: string,
  ext: "pdf" | "docx"
): string {
  return `${sopId}/${uploadSlug}/original.${ext}`;
}

export function buildPdfPath(sopId: string, uploadSlug: string): string {
  return `${sopId}/${uploadSlug}/document.pdf`;
}
