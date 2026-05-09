// src/components/sop-upload-form.tsx
"use client";

import { useState, useTransition, useRef } from "react";
import type { Sop, SopAudience } from "@/types/sops";
import { DOCX_MIME, MAX_SOP_FILE_BYTES, PDF_MIME } from "@/types/sops";

interface SopUploadFormProps {
  open: boolean;
  mode: "create" | "edit";
  initial?: Sop;
  onCancel: () => void;
  onSubmit: (formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
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
  const [fileTypeHint, setFileTypeHint] = useState<"pdf" | "docx" | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  if (!open) return null;

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
        ref={formRef}
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

        <label className="mt-4 block text-sm text-gray-300">
          Title <span className="text-xs text-gray-500">(optional — defaults to file name)</span>
          <input
            name="title"
            defaultValue={initial?.title ?? ""}
            placeholder="Defaults to uploaded file name"
            className="mt-1 w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-gray-100"
          />
        </label>

        <label className="mt-3 block text-sm text-gray-300">
          Description
          <textarea
            name="description"
            rows={3}
            defaultValue={initial?.description ?? ""}
            className="mt-1 w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-gray-100"
          />
        </label>

        <fieldset className="mt-3 text-sm text-gray-300">
          <legend className="mb-1">Audience</legend>
          {(["shared", "management_only"] as SopAudience[]).map((aud) => (
            <label key={aud} className="mr-4 inline-flex items-center gap-2">
              <input
                type="radio"
                name="audience"
                value={aud}
                required
                defaultChecked={(initial?.audience ?? "shared") === aud}
              />
              {aud === "shared" ? "Shared" : "Management only"}
            </label>
          ))}
        </fieldset>

        <label className="mt-3 block text-sm text-gray-300">
          File ({mode === "edit" ? "leave blank to keep existing" : "PDF or DOCX, max 25 MB"})
          <input
            type="file"
            name="file"
            accept={`${PDF_MIME},${DOCX_MIME},.pdf,.docx`}
            required={mode === "create"}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return setFileTypeHint(null);
              if (f.size > MAX_SOP_FILE_BYTES) {
                setError("File exceeds 25 MB limit");
                e.target.value = "";
                return setFileTypeHint(null);
              }
              setError(null);
              setFileTypeHint(f.type === DOCX_MIME ? "docx" : "pdf");
            }}
            className="mt-1 block w-full text-sm text-gray-300"
          />
        </label>

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
              ? fileTypeHint === "docx"
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
