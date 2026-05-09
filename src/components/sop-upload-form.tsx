// src/components/sop-upload-form.tsx
"use client";

import { useRef, useState, useTransition } from "react";
import type { Sop, SopAudience } from "@/types/sops";
import { DOCX_MIME, MAX_SOP_FILE_BYTES, PDF_MIME } from "@/types/sops";
import { deriveBaseName } from "@/lib/sops/storage";

interface SopUploadFormProps {
  open: boolean;
  mode: "create" | "edit";
  initial?: Sop;
  onCancel: () => void;
  onSubmit: (formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
}

const AUDIENCES: { value: SopAudience; label: string }[] = [
  { value: "shared", label: "Shared" },
  { value: "management_only", label: "Management only" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SopUploadForm({
  open,
  mode,
  initial,
  onCancel,
  onSubmit,
}: SopUploadFormProps) {
  const allowMultiple = mode === "create";

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [audience, setAudience] = useState<SopAudience>(initial?.audience ?? "shared");
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const isBatch = files.length > 1;
  const singleFileType: "pdf" | "docx" | null =
    files.length === 1 ? (files[0].type === DOCX_MIME ? "docx" : "pdf") : null;
  const anyDocx = files.some((f) => f.type === DOCX_MIME);

  function addFiles(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    const next: File[] = [];
    const seen = new Set(files.map((f) => `${f.name}:${f.size}`));
    for (const f of Array.from(picked)) {
      if (f.size > MAX_SOP_FILE_BYTES) {
        setError(`"${f.name}" exceeds the 25 MB limit`);
        continue;
      }
      if (f.type !== PDF_MIME && f.type !== DOCX_MIME) {
        setError(`"${f.name}" is not a PDF or DOCX`);
        continue;
      }
      const key = `${f.name}:${f.size}`;
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(f);
    }
    if (next.length === 0) return;
    setError(null);
    setFiles(allowMultiple ? [...files, ...next] : next.slice(0, 1));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeFile(idx: number) {
    setFiles(files.filter((_, i) => i !== idx));
  }

  function clearAll() {
    setFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <form
        action={(fd) => {
          setError(null);
          if (mode === "create" && files.length === 0) {
            setError("Add at least one file");
            return;
          }

          const titleInput = (fd.get("title")?.toString() ?? "").trim();
          const description = (fd.get("description")?.toString() ?? "").trim();

          startTransition(async () => {
            // Edit mode: keep existing single-file behavior.
            if (mode === "edit") {
              const fdEdit = new FormData();
              fdEdit.append("title", titleInput);
              fdEdit.append("description", description);
              fdEdit.append("audience", audience);
              if (files[0]) fdEdit.append("file", files[0]);
              const res = await onSubmit(fdEdit);
              if (!res.ok) setError(res.error);
              else onCancel();
              return;
            }

            // Create mode: one onSubmit call per file. Title/description
            // only apply when a single file is being uploaded; for batches
            // each SOP gets its title auto-derived server-side.
            setProgress({ done: 0, total: files.length });
            for (let i = 0; i < files.length; i++) {
              const file = files[i];
              const perFile = new FormData();
              perFile.append("title", isBatch ? "" : titleInput);
              perFile.append("description", isBatch ? "" : description);
              perFile.append("audience", audience);
              perFile.append("file", file);
              const res = await onSubmit(perFile);
              if (!res.ok) {
                setError(`Failed on "${file.name}": ${res.error}`);
                setProgress(null);
                return;
              }
              setProgress({ done: i + 1, total: files.length });
            }
            setProgress(null);
            onCancel();
          });
        }}
        className="w-full max-w-md rounded-xl bg-gray-900 p-5 shadow-xl"
      >
        <h2 className="text-base font-semibold text-gray-100">
          {mode === "create" ? "Upload SOPs" : "Edit SOP"}
        </h2>

        <input
          ref={fileInputRef}
          type="file"
          accept={`${PDF_MIME},${DOCX_MIME},.pdf,.docx`}
          multiple={allowMultiple}
          className="sr-only"
          onChange={(e) => addFiles(e.target.files)}
        />

        <div className="mt-4 space-y-2">
          {files.length > 0 && (
            <ul className="max-h-56 space-y-2 overflow-y-auto pr-0.5">
              {files.map((f, i) => (
                <li key={`${f.name}:${f.size}:${i}`}>
                  <FileChip file={f} onRemove={() => removeFile(i)} />
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-gray-700 bg-gray-950 px-4 py-5 text-sm text-gray-300 hover:border-gray-600 hover:bg-gray-900"
          >
            <span className="font-medium">
              {files.length === 0
                ? mode === "edit"
                  ? "Replace file (optional)"
                  : "Choose files"
                : allowMultiple
                ? "Add more files"
                : "Replace file"}
            </span>
            <span className="text-xs text-gray-500">
              {allowMultiple
                ? "PDF or DOCX, up to 25 MB each — pick multiple"
                : "PDF or DOCX, max 25 MB"}
            </span>
          </button>

          {files.length > 1 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              Remove all
            </button>
          )}
        </div>

        {!isBatch && (
          <>
            <label className="mt-4 block text-sm text-gray-300">
              Title
              <input
                name="title"
                defaultValue={initial?.title ?? ""}
                placeholder={
                  files[0]
                    ? deriveBaseName(files[0].name)
                    : "Defaults to file name"
                }
                className="mt-1 w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-gray-100 placeholder:text-gray-600"
              />
            </label>

            <label className="mt-3 block text-sm text-gray-300">
              Description <span className="text-xs text-gray-600">(optional)</span>
              <textarea
                name="description"
                rows={2}
                defaultValue={initial?.description ?? ""}
                className="mt-1 w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-gray-100"
              />
            </label>
          </>
        )}

        {isBatch && (
          <p className="mt-4 rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-xs text-gray-400">
            Each SOP&apos;s title will default to its file name. Edit individual
            SOPs after upload to customize.
          </p>
        )}

        <div className="mt-4">
          <p className="mb-1 text-sm text-gray-300">Audience</p>
          <input type="hidden" name="audience" value={audience} />
          <div className="flex w-full rounded-md border border-gray-800 bg-gray-950 p-0.5">
            {AUDIENCES.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setAudience(opt.value)}
                className={
                  audience === opt.value
                    ? "flex-1 rounded-sm bg-blue-900/60 px-3 py-1.5 text-sm font-medium text-blue-100"
                    : "flex-1 rounded-sm px-3 py-1.5 text-sm text-gray-400 hover:text-gray-100"
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="mt-3 rounded-md bg-red-950/60 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg py-2.5 text-sm text-gray-300 hover:text-gray-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || (mode === "create" && files.length === 0)}
            className="flex-1 rounded-lg bg-blue-700 py-2.5 text-sm font-medium text-blue-50 hover:bg-blue-600 disabled:bg-blue-900 disabled:text-blue-300"
          >
            {pending
              ? progress && progress.total > 1
                ? `Uploading ${progress.done + 1}/${progress.total}…`
                : (singleFileType === "docx" || (isBatch && anyDocx))
                ? "Converting…"
                : "Saving…"
              : mode === "create"
              ? files.length > 1
                ? `Upload ${files.length} SOPs`
                : "Upload"
              : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}

function FileChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const isDocx = file.type === DOCX_MIME;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-950 px-3 py-2.5">
      <div
        className={
          isDocx
            ? "flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-900/60 text-[10px] font-bold uppercase text-blue-200"
            : "flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-900/60 text-[10px] font-bold uppercase text-emerald-200"
        }
      >
        {isDocx ? "DOCX" : "PDF"}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-100">{file.name}</p>
        <p className="text-xs text-gray-500">{formatBytes(file.size)}</p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="rounded-md px-2 py-1 text-sm text-gray-400 hover:bg-gray-800 hover:text-gray-100"
        aria-label="Remove file"
      >
        ✕
      </button>
    </div>
  );
}
