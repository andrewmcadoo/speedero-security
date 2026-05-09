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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [audience, setAudience] = useState<SopAudience>(initial?.audience ?? "shared");
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const fileType: "pdf" | "docx" | null = selectedFile
    ? selectedFile.type === DOCX_MIME
      ? "docx"
      : "pdf"
    : null;

  function clearFile() {
    setSelectedFile(null);
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
          startTransition(async () => {
            const res = await onSubmit(fd);
            if (!res.ok) setError(res.error);
            else onCancel();
          });
        }}
        className="w-full max-w-md rounded-xl bg-gray-900 p-5 shadow-xl"
      >
        <h2 className="text-base font-semibold text-gray-100">
          {mode === "create" ? "Upload SOP" : "Edit SOP"}
        </h2>

        <input
          ref={fileInputRef}
          type="file"
          name="file"
          accept={`${PDF_MIME},${DOCX_MIME},.pdf,.docx`}
          required={mode === "create"}
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            if (!f) {
              setSelectedFile(null);
              return;
            }
            if (f.size > MAX_SOP_FILE_BYTES) {
              setError("File exceeds 25 MB limit");
              e.target.value = "";
              setSelectedFile(null);
              return;
            }
            setError(null);
            setSelectedFile(f);
          }}
        />

        <div className="mt-4">
          {selectedFile ? (
            <FileChip file={selectedFile} onRemove={clearFile} />
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-gray-700 bg-gray-950 px-4 py-6 text-sm text-gray-300 hover:border-gray-600 hover:bg-gray-900"
            >
              <span className="font-medium">
                {mode === "edit" ? "Replace file (optional)" : "Choose a file"}
              </span>
              <span className="text-xs text-gray-500">PDF or DOCX, max 25 MB</span>
            </button>
          )}
        </div>

        <label className="mt-4 block text-sm text-gray-300">
          Title
          <input
            name="title"
            defaultValue={initial?.title ?? ""}
            placeholder={selectedFile ? deriveBaseName(selectedFile.name) : "Defaults to file name"}
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
            disabled={pending}
            className="flex-1 rounded-lg bg-blue-700 py-2.5 text-sm font-medium text-blue-50 hover:bg-blue-600 disabled:bg-blue-900 disabled:text-blue-300"
          >
            {pending
              ? fileType === "docx"
                ? "Converting…"
                : "Saving…"
              : mode === "create"
              ? "Upload"
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
    <div className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-950 px-3 py-3">
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
