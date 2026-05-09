// src/app/sops/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import {
  buildOriginalPath,
  buildPdfPath,
  buildUploadSlug,
  SOPS_BUCKET,
} from "@/lib/sops/storage";
import {
  convertDocxToPdf,
  DocxConversionError,
} from "@/lib/sops/convert";
import {
  fileTypeFromMime,
  MAX_SOP_FILE_BYTES,
  PDF_MIME,
  type SopAudience,
} from "@/types/sops";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

// Loose stub type — see src/app/dashboard/actions.ts for the same pattern.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any;

type Factory = () => SupabaseLike | Promise<SupabaseLike>;

function parseAudience(raw: FormDataEntryValue | null): SopAudience | null {
  if (raw === "shared" || raw === "management_only") return raw;
  return null;
}

export async function _uploadSopForTest(
  formData: FormData,
  factory: Factory,
  now: Date
): Promise<ActionResult> {
  const supabase = await factory();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const title = (formData.get("title")?.toString() ?? "").trim();
  if (!title) return { ok: false, error: "Title is required" };

  const description = (formData.get("description")?.toString() ?? "").trim() || null;

  const audience = parseAudience(formData.get("audience"));
  if (!audience) return { ok: false, error: "Audience is required" };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "File is required" };
  if (file.size > MAX_SOP_FILE_BYTES) {
    return { ok: false, error: "File exceeds 25 MB limit" };
  }
  const fileType = fileTypeFromMime(file.type);
  if (!fileType) return { ok: false, error: "Only PDF and DOCX files are supported" };

  const sopId = randomUUID();
  const slug = buildUploadSlug(now);
  const originalPath = buildOriginalPath(sopId, slug, fileType);
  const pdfPath = fileType === "pdf" ? originalPath : buildPdfPath(sopId, slug);

  const originalBytes = Buffer.from(await file.arrayBuffer());
  const uploaded: string[] = [];

  try {
    const upOriginal = await supabase.storage.from(SOPS_BUCKET).upload(
      originalPath,
      originalBytes,
      { contentType: file.type, upsert: false }
    );
    if (upOriginal.error) {
      return { ok: false, error: `Storage upload failed: ${upOriginal.error.message}` };
    }
    uploaded.push(originalPath);

    if (fileType === "docx") {
      let pdfBytes: Buffer;
      try {
        pdfBytes = await convertDocxToPdf(originalBytes);
      } catch (err) {
        const msg =
          err instanceof DocxConversionError
            ? "Couldn't convert this DOCX. Try re-exporting it from Word, or upload a PDF."
            : "DOCX conversion failed";
        await rollback(supabase, uploaded);
        return { ok: false, error: msg };
      }
      const upPdf = await supabase.storage.from(SOPS_BUCKET).upload(
        pdfPath,
        pdfBytes,
        { contentType: PDF_MIME, upsert: false }
      );
      if (upPdf.error) {
        await rollback(supabase, uploaded);
        return { ok: false, error: `Storage upload failed: ${upPdf.error.message}` };
      }
      uploaded.push(pdfPath);
    }

    const rpc = await supabase.rpc("record_sop_upload", {
      p_sop_id: sopId,
      p_title: title,
      p_description: description,
      p_audience: audience,
      p_storage_path_pdf: pdfPath,
      p_storage_path_original: originalPath,
      p_original_filename: file.name,
      p_original_mime_type: file.type,
      p_file_size_bytes: file.size,
      p_actor_id: user.id,
    });
    if (rpc.error) {
      await rollback(supabase, uploaded);
      return { ok: false, error: `Database write failed: ${rpc.error.message}` };
    }

    return { ok: true, id: sopId };
  } catch (err) {
    await rollback(supabase, uploaded);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Upload failed",
    };
  }
}

async function rollback(supabase: SupabaseLike, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await supabase.storage.from(SOPS_BUCKET).remove(paths);
  } catch (err) {
    console.error("[sops] rollback failed:", err);
  }
}

export async function uploadSop(formData: FormData): Promise<ActionResult> {
  const result = await _uploadSopForTest(
    formData,
    async () => (await createClient()) as unknown as SupabaseLike,
    new Date()
  );
  if (result.ok) {
    revalidatePath("/sops");
    revalidatePath("/sops/audit");
  }
  return result;
}

export async function _updateSopForTest(
  id: string,
  formData: FormData,
  factory: Factory,
  now: Date
): Promise<ActionResult> {
  const supabase = await factory();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const title = (formData.get("title")?.toString() ?? "").trim();
  if (!title) return { ok: false, error: "Title is required" };
  const description = (formData.get("description")?.toString() ?? "").trim() || null;
  const audience = parseAudience(formData.get("audience"));
  if (!audience) return { ok: false, error: "Audience is required" };

  // Look up the current row so we can preserve its storage paths if no
  // new file was uploaded.
  const currentResp = await supabase
    .from("sops")
    .select(
      "id, storage_path_pdf, storage_path_original, original_filename, original_mime_type"
    )
    .eq("id", id)
    .maybeSingle();
  if (currentResp.error || !currentResp.data) {
    return { ok: false, error: "SOP not found" };
  }

  const file = formData.get("file");
  let newOriginalPath: string | null = null;
  let newPdfPath: string | null = null;
  let newFilename: string | null = null;
  let newMime: string | null = null;
  let newSize: number | null = null;
  const uploaded: string[] = [];

  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_SOP_FILE_BYTES) {
      return { ok: false, error: "File exceeds 25 MB limit" };
    }
    const fileType = fileTypeFromMime(file.type);
    if (!fileType) return { ok: false, error: "Only PDF and DOCX files are supported" };

    const slug = buildUploadSlug(now);
    newOriginalPath = buildOriginalPath(id, slug, fileType);
    newPdfPath = fileType === "pdf" ? newOriginalPath : buildPdfPath(id, slug);
    newFilename = file.name;
    newMime = file.type;
    newSize = file.size;

    const originalBytes = Buffer.from(await file.arrayBuffer());
    const upOriginal = await supabase.storage.from(SOPS_BUCKET).upload(
      newOriginalPath,
      originalBytes,
      { contentType: file.type, upsert: false }
    );
    if (upOriginal.error) {
      return { ok: false, error: `Storage upload failed: ${upOriginal.error.message}` };
    }
    uploaded.push(newOriginalPath);

    if (fileType === "docx") {
      let pdfBytes: Buffer;
      try {
        pdfBytes = await convertDocxToPdf(originalBytes);
      } catch (err) {
        await rollback(supabase, uploaded);
        const msg =
          err instanceof DocxConversionError
            ? "Couldn't convert this DOCX. Try re-exporting it from Word, or upload a PDF."
            : "DOCX conversion failed";
        return { ok: false, error: msg };
      }
      const upPdf = await supabase.storage.from(SOPS_BUCKET).upload(
        newPdfPath,
        pdfBytes,
        { contentType: PDF_MIME, upsert: false }
      );
      if (upPdf.error) {
        await rollback(supabase, uploaded);
        return { ok: false, error: `Storage upload failed: ${upPdf.error.message}` };
      }
      uploaded.push(newPdfPath);
    }
  }

  const rpc = await supabase.rpc("record_sop_update", {
    p_sop_id: id,
    p_actor_id: user.id,
    p_new_title: title,
    p_new_description: description,
    p_new_audience: audience,
    p_new_storage_path_pdf: newPdfPath,
    p_new_storage_path_original: newOriginalPath,
    p_new_original_filename: newFilename,
    p_new_original_mime_type: newMime,
    p_new_file_size_bytes: newSize,
  });
  if (rpc.error) {
    await rollback(supabase, uploaded);
    return { ok: false, error: `Database write failed: ${rpc.error.message}` };
  }

  return { ok: true, id };
}

export async function updateSop(
  id: string,
  formData: FormData
): Promise<ActionResult> {
  const result = await _updateSopForTest(
    id,
    formData,
    async () => (await createClient()) as unknown as SupabaseLike,
    new Date()
  );
  if (result.ok) {
    revalidatePath("/sops");
    revalidatePath(`/sops/${id}`);
    revalidatePath("/sops/audit");
  }
  return result;
}

export async function _deleteSopForTest(
  id: string,
  factory: Factory
): Promise<ActionResult> {
  const supabase = await factory();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const rpc = await supabase.rpc("record_sop_delete", {
    p_sop_id: id,
    p_actor_id: user.id,
  });
  if (rpc.error) {
    return { ok: false, error: `Delete failed: ${rpc.error.message}` };
  }
  return { ok: true };
}

export async function deleteSop(id: string): Promise<ActionResult> {
  const result = await _deleteSopForTest(
    id,
    async () => (await createClient()) as unknown as SupabaseLike
  );
  if (result.ok) {
    revalidatePath("/sops");
    revalidatePath("/sops/audit");
  }
  return result;
}
