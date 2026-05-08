# Standard Operating Procedures (SOPs) — Design

**Date:** 2026-05-08
**Branch:** feat/sops (proposed)

## Problem

Managers need a place to publish Standard Operating Procedures (SOPs) inside the app, and EPOs need to read the ones intended for them. Today there is no in-app surface for this — procedures live in shared drives or email threads, which makes it hard to know what the current version is or who has access to which document.

Two audiences:

- **Shared SOPs** — visible to both EPOs and management.
- **Management-only SOPs** — visible to management only.

## Goals

- Managers can upload, edit, and delete SOPs.
- EPOs can read shared SOPs in a clean in-app viewer.
- Visibility (`shared` vs `management_only`) is enforced by Supabase RLS, not just by the UI.
- Both PDF and DOCX uploads are accepted; both are viewable in-app as PDF.
- The list and viewer work on mobile (per the recent dashboard mobile-polish work).

## Non-Goals

The following are explicitly out of scope for v1. Each can be added later without breaking the schema or storage layout.

- View tracking, acknowledgment, or "unread" badges.
- Version history / file revisions (replace-in-place only).
- Categories, tags, folders, or full-text search.
- Notifications when a new SOP is published.
- Bulk upload, multi-file zip, or in-app DOCX editing.
- External sharing or non-member access.

## Design Overview

A new top-level route `/SecApp/sops` with:

- A shared header introducing two tabs (`Dashboard`, `SOPs`) that both roles see.
- A list view that adapts to role: managers see all SOPs with audience badges and CRUD controls; EPOs see only shared SOPs and can read them.
- A dedicated viewer page at `/sops/[id]` that renders a PDF in an iframe over a short-lived signed Supabase Storage URL.
- An upload modal that validates input, uploads the original file, converts DOCX → PDF server-side using LibreOffice headless on Clipper, and inserts a single row.

One Supabase table (`sops`), one Supabase Storage bucket (`sops`), audience enforced by RLS in both Postgres and Storage policies.

## Data Model

### Migration `012_sops.sql`

```sql
create type sop_audience as enum ('shared', 'management_only');

create table sops (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  audience sop_audience not null,
  storage_path_pdf text not null,
  storage_path_original text not null,
  original_filename text not null,
  original_mime_type text not null,
  file_size_bytes bigint not null,
  uploaded_by uuid not null references profiles(id),
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_sops_audience on sops(audience);
create index idx_sops_uploaded_at on sops(uploaded_at desc);
```

When the upload is a PDF, `storage_path_original == storage_path_pdf` (one file in storage). When the upload is a DOCX, two files are stored: the original `.docx` (served as the "Download" button target) and the converted `.pdf` (loaded by the viewer).

### RLS

Reuses the existing `is_management()` helper from migration 001.

- `sops` SELECT
  - Management: all rows.
  - EPO: rows where `audience = 'shared'`.
- `sops` INSERT / UPDATE / DELETE: management only.
- Storage bucket `sops` policies mirror the same checks. Read policies join back to the `sops` table by storage path so audience changes flow through naturally.

Hard delete (no soft delete) — matches the "replace in place, no history" framing.

## UI

### Top nav

A new shared header component `<AppHeader>` (`src/components/app-header.tsx`) with two tabs: `Dashboard` and `SOPs`. Both roles see both tabs. The header is sticky, consistent with the dashboard's pinned-chrome pattern from the recent today-anchor work.

### `/sops` — list view

Role-driven list of SOPs. One component (`<SopsList>`) is prop-driven for the role differences:

| Element | EPO | Management |
|---|---|---|
| Rows shown | `audience = 'shared'` only | All rows |
| Audience badge per row | Hidden | "Shared" / "Management only" pill |
| Audience filter control | Hidden | Segmented control: All / Shared / Management only |
| Per-row actions | Click row → viewer | Click row → viewer; row also has Edit + Delete |
| Upload button | Hidden | "Upload SOP" button top-right |
| Empty state | "No SOPs available yet." | "No SOPs uploaded. Click Upload to add the first one." |

Each row shows: title (bold), description (one-line truncated), uploader name, last-updated date, file-type pill (PDF / DOCX). Default sort: `uploaded_at desc`. Client-side toggle to sort by title.

### `/sops/[id]` — viewer

Dedicated page so the URL is shareable and the back button works. Layout:

- Header strip: title, audience badge (management only), uploader and date.
- PDF iframe filling the main area, `src` = a 5-minute signed URL to `storage_path_pdf`.
- "Download original" button below the iframe — links to a 5-minute signed URL for `storage_path_original`. For PDF uploads, this is the same file as the viewer.

On mobile, the iframe renders full-width; download is the primary action since pinch-to-zoom on embedded PDFs is inconsistent across mobile browsers.

### Upload modal (manager only)

A `<Dialog>`-based modal opened from the list page (no separate route for v1). Form fields:

- **Title** (required, text)
- **Description** (optional, textarea)
- **Audience** (required, radio: Shared / Management only)
- **File** (required on create, optional on edit; `.pdf` or `.docx`; max 25 MB)

Submit calls `uploadSop` server action. While the action runs, the submit button shows a `Converting…` state when a DOCX is being processed, since LibreOffice conversion adds a few seconds of latency on top of upload.

### Edit modal (manager only)

Same component, pre-filled. File picker is optional — leaving it empty keeps the existing file and only updates metadata.

### Delete (manager only)

Reuses the existing `confirm-dialog.tsx` component. Hard-deletes the row and both storage objects.

## Server Actions and Conversion

All server-side logic lives in `src/app/sops/actions.ts` and `src/lib/sops/convert.ts`. None of these run on the client.

### `uploadSop(formData)`

1. Auth check — bail if the session is not management.
2. Parse FormData; validate title non-empty, audience is a valid enum, file MIME is `application/pdf` or the DOCX MIME, file size ≤ 25 MB.
3. Generate a `sopId` up front. Storage paths are namespaced by it: `sops/${sopId}/original.{pdf,docx}` and `sops/${sopId}/document.pdf`.
4. Upload the original file to Storage at `sops/${sopId}/original.{ext}`.
5. If the upload is a PDF: skip conversion. `storage_path_pdf = storage_path_original`.
6. If the upload is a DOCX: write the buffer to `os.tmpdir()`, invoke `convertDocxToPdf`, upload the resulting PDF to `sops/${sopId}/document.pdf`, clean up temp files.
7. Insert the `sops` row with both paths, MIME, size, and uploader.
8. `revalidatePath('/sops')`.
9. On any failure after a partial storage write, best-effort delete the orphaned storage objects so we don't leak files.

### `updateSop(id, formData)`

Same shape. If the file picker is empty, skip steps 4–6 and only update metadata. If a new file is provided, run the full upload+convert path, update the row, then delete the old storage objects after the row update succeeds.

### `deleteSop(id)`

Auth check, delete storage objects, delete the row.

### `convertDocxToPdf(input: Buffer): Promise<Buffer>`

Lives in `src/lib/sops/convert.ts`.

- Writes `input` to a unique file under `os.tmpdir()`.
- Spawns `soffice --headless --convert-to pdf --outdir <tmpdir> <input.docx>` via `child_process.spawn` with a strict argv (no shell interpolation).
- 30 second timeout. On timeout, kills the child and rejects.
- Reads the produced PDF, deletes both temp files, returns the buffer.

LibreOffice is the same engine Google Docs uses for DOCX rendering; fidelity is good and the runtime license (MPL 2.0) is fine. Pure-JS alternatives all trade fidelity for footprint.

### Failure modes

- **Validation failure** (wrong type, oversized): server action returns an error result; modal shows inline message; nothing written.
- **Conversion failure** (corrupt DOCX, soffice crash, timeout): no row inserted, orphaned `original.docx` deleted, modal shows "Couldn't convert this DOCX. Try re-exporting it from Word, or upload a PDF." The manager can retry.
- **Storage failure mid-flow**: best-effort cleanup, error surfaced.

## File Layout

Following existing conventions (`src/app/dashboard/`, `src/lib/dashboard/`):

```
src/app/sops/
  page.tsx                      # list view, role-aware
  [id]/page.tsx                 # viewer
  actions.ts                    # uploadSop, updateSop, deleteSop
src/components/
  app-header.tsx                # NEW — shared Dashboard / SOPs tabs
  sops-list.tsx                 # role-driven list
  sop-upload-form.tsx           # form used in modal
  sop-viewer.tsx                # iframe + download button
src/lib/sops/
  convert.ts                    # convertDocxToPdf
  convert.test.ts
  storage.ts                    # signed URL helpers, path builders
  storage.test.ts
src/lib/supabase/
  queries.ts                    # extend with getSops, getSopById
supabase/migrations/
  012_sops.sql                  # table + enum + indexes + RLS + storage policies
```

## Testing

- **Unit**: `convert.ts` with `spawn` mocked (covers timeout, non-zero exit, missing output file, success path); storage path builders; query helpers' audience filter logic.
- **Integration**: `actions.ts` round-trip — upload PDF, edit metadata only, delete. DOCX integration test runs only when `soffice` is available locally; otherwise skips with a clear message.
- **Access control**: tests that an EPO session cannot SELECT a `management_only` SOP, that the Upload button doesn't render in EPO sessions, and that calling `uploadSop` from an EPO session returns an unauthorized error.

## Deploy Prerequisites

LibreOffice headless must be installed on Clipper before this feature is deployed:

```bash
ssh clipper "sudo zypper install -y libreoffice"
ssh clipper "soffice --version"   # confirm the app's runtime user can invoke it
```

This is a one-time install and does not need to be re-run on subsequent deploys. Without it, DOCX uploads will fail with a clear error; PDF uploads will continue to work.

## Mobile

The SOPs list collapses to single-column cards on narrow viewports, mirroring the dashboard's mobile pattern. The viewer's iframe renders full-width; "Download original" is the primary mobile action. Upload from mobile is supported but not optimized — file pickers vary across mobile browsers and we do not work around platform quirks here.
