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
- Every SOP mutation (upload, replace, metadata edit, visibility change, delete) produces an immutable audit record. Management can search and review the full history. The audit log is append-only — not editable or deletable through the UI or the application's database role.
- File content is preserved across replacements and deletions so the audit log can answer "what was in force at date X" and "what file replaced what" with the actual document content, not just metadata.

## Non-Goals

The following are explicitly out of scope for v1. Each can be added later without breaking the schema or storage layout.

- View tracking, acknowledgment, or "unread" badges.
- User-facing version picker / "view previous version" UI on the SOP itself. (The audit log preserves content and references; there's just no version-history surface in the SOP viewer.)
- Categories, tags, folders, or full-text search of SOP content.
- Notifications when a new SOP is published or audited.
- Bulk upload, multi-file zip, or in-app DOCX editing.
- External sharing or non-member access.
- File diff or rendered comparison between historical versions.
- Rollback / "restore this version" UI.
- Audit log export to CSV/PDF for legal discovery.

## Design Overview

A new top-level route `/SecApp/sops` with:

- A shared header introducing two tabs (`Dashboard`, `SOPs`) that both roles see.
- A list view that adapts to role: managers see all SOPs with audience badges and CRUD controls; EPOs see only shared SOPs and can read them.
- A dedicated viewer page at `/sops/[id]` that renders a PDF in an iframe over a short-lived signed Supabase Storage URL.
- An upload modal that validates input, uploads the original file, converts DOCX → PDF server-side using LibreOffice headless on Clipper, and inserts a single row.
- A separate management-only audit page at `/sops/audit` — read-only, filterable by date / actor / action / title, with per-document chronology drill-down.

Two Supabase tables (`sops` for current state, `sop_audit_log` for the immutable history), one Supabase Storage bucket (`sops`) whose objects are never deleted by the application. Audience enforced by RLS in both Postgres and Storage policies. Every live mutation and its corresponding audit insert happen atomically inside a single Postgres transaction via RPC functions.

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

### Storage path scheme

Storage paths are versioned per upload so replacements never overwrite, which is what makes the audit log's content-preservation guarantee real:

```
sops/${sopId}/${uploadSlug}/original.{pdf,docx}
sops/${sopId}/${uploadSlug}/document.pdf
```

`uploadSlug` is the upload's timestamp formatted as `YYYYMMDDTHHMMSSZ` (UTC, no colons or hyphens) so the path is URL-safe. The full ISO timestamp is also written to `sops.uploaded_at` for human-readable display; the slug is just the path-safe encoding of the same instant. After a replace, the old folder remains untouched in storage and is referenced by the corresponding `sop_audit_log` row's `superseded_storage_path`. After a delete, the `sops` row is removed but the storage objects stay in place — the `sop_audit_log` `delete` row holds the path.

### RLS

Reuses the existing `is_management()` helper from migration 001.

- `sops` SELECT
  - Management: all rows.
  - EPO: rows where `audience = 'shared'`.
- `sops` INSERT / UPDATE / DELETE: management only.
- Storage bucket `sops` policies mirror the same checks for *current* paths. Historical paths (referenced only by the audit log) are readable by management only; EPO read policies match against current `sops` row paths.

The `sops` row is hard-deleted on user delete (no soft-delete column), but storage objects survive — see the audit subsystem section. Audit-table immutability is described in its own section below.

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

Reuses the existing `confirm-dialog.tsx` component. Hard-deletes the `sops` row. Storage objects are intentionally **not** deleted — they remain referenced by the audit log so the SOP's content can be reconstructed for any past point in time.

### Audit log entry point

The manager's `/sops` list view has a small "Audit log" link in its header that opens `/sops/audit`. EPOs do not see this link; the route also enforces management-only access server-side and redirects EPO sessions to `/sops`.

## Server Actions and Conversion

All server-side logic lives in `src/app/sops/actions.ts` and `src/lib/sops/convert.ts`. None of these run on the client.

### `uploadSop(formData)`

1. Auth check — bail if the session is not management.
2. Parse FormData; validate title non-empty, audience is a valid enum, file MIME is `application/pdf` or the DOCX MIME, file size ≤ 25 MB.
3. Generate a `sopId` and an `uploadSlug` (path-safe UTC timestamp, see Storage Path Scheme). Storage paths: `sops/${sopId}/${uploadSlug}/original.{pdf,docx}` and `sops/${sopId}/${uploadSlug}/document.pdf`.
4. Upload the original file to Storage at the original path.
5. If the upload is a PDF: skip conversion. `storage_path_pdf = storage_path_original`.
6. If the upload is a DOCX: write the buffer to `os.tmpdir()`, invoke `convertDocxToPdf`, upload the resulting PDF to the document path, clean up temp files.
7. Call `record_sop_upload` RPC — atomically inserts the `sops` row and the `upload` audit log row inside one transaction.
8. `revalidatePath('/sops')` and `revalidatePath('/sops/audit')`.
9. On any failure before step 7, best-effort delete the just-uploaded storage objects so we don't leak orphans. Failures *after* step 7 leave the row + audit intact (correct outcome — both succeeded together).

### `updateSop(id, formData)`

Auth check + validation as above. Determine which fields changed (title, description, audience, file).

- If only metadata changed: call `record_sop_update` RPC, which updates the row and inserts the appropriate `edit_metadata` and/or `visibility_change` audit rows in one transaction.
- If the file changed (with or without metadata changes): run the upload+convert path against a *new* timestamped storage path, then call `record_sop_update` RPC, which updates the row's storage paths and inserts `replace_file` plus any concurrent `edit_metadata` / `visibility_change` rows in one transaction. The previous storage objects are **not** deleted — they remain referenced by the new `replace_file` audit row's `superseded_storage_path`.

One audit row per change type per save (so a title-edit-plus-file-replace produces two audit rows).

### `deleteSop(id)`

Auth check. Call `record_sop_delete` RPC, which deletes the `sops` row and inserts a `delete` audit row carrying the storage path that was in force at deletion. Storage objects are not removed.

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

## Audit Log Subsystem

### Schema (Migration `013_sop_audit_log.sql`)

```sql
create extension if not exists pg_trgm;

create type sop_audit_action as enum (
  'upload',
  'replace_file',
  'edit_metadata',
  'visibility_change',
  'delete'
);

create table sop_audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid not null references profiles(id),
  sop_id uuid not null,                       -- NOT a FK; survives sop row deletion
  action sop_audit_action not null,

  -- Snapshot at time of action — audit row stands alone after live row is gone.
  title_at_action text not null,
  audience_at_action sop_audience not null,

  -- File context — populated for upload, replace_file, delete.
  new_storage_path text,
  new_filename text,
  new_mime_type text,
  new_file_size_bytes bigint,
  superseded_storage_path text,               -- replace_file, delete
  superseded_filename text,

  -- Metadata diffs.
  prev_title text,                            -- edit_metadata
  prev_description text,                      -- edit_metadata
  next_description text,                      -- edit_metadata
  prev_audience sop_audience                  -- visibility_change
);

create index idx_sop_audit_sop_id on sop_audit_log(sop_id, occurred_at desc);
create index idx_sop_audit_occurred_at on sop_audit_log(occurred_at desc);
create index idx_sop_audit_title_trgm on sop_audit_log using gin (title_at_action gin_trgm_ops);
```

`sop_id` is intentionally not a foreign key so audit rows survive deletion of the `sops` row they describe.

### Per-action payloads

| Action | Fields populated (besides timestamp / actor / sop_id / action / title / audience snapshot) |
|---|---|
| `upload` | `new_storage_path`, `new_filename`, `new_mime_type`, `new_file_size_bytes` |
| `replace_file` | `new_*` (as above) plus `superseded_storage_path`, `superseded_filename` |
| `edit_metadata` | `prev_title`, `prev_description`, `next_description` (any combination of title/description deltas; `title_at_action` reflects the post-edit value) |
| `visibility_change` | `prev_audience`; `audience_at_action` reflects the post-change value |
| `delete` | `superseded_storage_path`, `superseded_filename` (the file in force at deletion) |

### Immutability — three layers

```sql
-- 1. RLS: management can SELECT; absence of UPDATE/DELETE policies denies them.
alter table sop_audit_log enable row level security;
create policy "Management can read audit log"
  on sop_audit_log for select using (is_management());

-- 2. Revoke privileges so even direct DB access cannot mutate.
revoke update, delete on sop_audit_log from anon, authenticated, service_role;

-- 3. Trigger as defense in depth — catches owner-role bypass or future privilege grants.
create or replace function deny_audit_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'sop_audit_log is append-only; % blocked', tg_op;
end;
$$;

create trigger sop_audit_log_no_update before update on sop_audit_log
  for each row execute function deny_audit_mutation();
create trigger sop_audit_log_no_delete before delete on sop_audit_log
  for each row execute function deny_audit_mutation();
```

INSERT happens via `security definer` RPC functions invoked from the server actions; the API roles never get direct INSERT either, so there's no path to write a forged audit row through the client.

### RPC functions

`record_sop_upload`, `record_sop_update`, `record_sop_delete` live in the same migration. Each wraps the live mutation and the audit insert in a single PL/pgSQL block, marked `security definer` so they execute with the function-owner's privileges (sufficient to insert into `sop_audit_log` despite the API roles' missing privileges). The functions perform the management-role check internally as a second auth gate.

### Audit UI — `/sops/audit`

Management-only page (server-side redirect for EPO). Read-only.

**Filter bar** (top of page):
- Date range — start and end date pickers.
- Action type — multi-select chips (Upload, Replace, Edit metadata, Visibility change, Delete).
- Title search — substring match against `title_at_action`, backed by the `gin_trgm_ops` index.
- Actor — dropdown of management users (sourced from `profiles` where `role = 'management'`).

**Results table** (server-paginated, 50 per page):

| Column | Content |
|---|---|
| Timestamp | Localized to APP_TIMEZONE (e.g. `May 8, 2026  14:32 PT`) |
| Actor | Full name; tooltip shows email |
| Action | Colored badge (`upload` green, `replace_file` blue, `edit_metadata` gray, `visibility_change` amber, `delete` red) |
| Title at action | Click-through to `/sops/audit?sop_id=X` for that document's chronology |
| Summary | Human-readable line built from the audit row (see examples below) |
| File | "Download" button when the row references a storage path; generates a 5-minute signed URL to that historical path |

Summary line examples (built by `buildAuditSummary` in `src/lib/sops/audit.ts`):

- `upload` → `Uploaded procedure-v2.pdf (Shared)`
- `replace_file` → `Replaced procedure-v1.pdf with procedure-v2.pdf`
- `edit_metadata` → `Title: "Old Title" → "New Title"; description updated`
- `visibility_change` → `Audience: Shared → Management only`
- `delete` → `Deleted procedure-v3.pdf`

**Per-document chronology** is just `/sops/audit?sop_id=X` — the same page filtered by `sop_id`. The query parameter pins the title-search and actor filters open while showing all action types for that document by default.

## File Layout

Following existing conventions (`src/app/dashboard/`, `src/lib/dashboard/`):

```
src/app/sops/
  page.tsx                      # list view, role-aware
  [id]/page.tsx                 # viewer
  audit/page.tsx                # NEW — management-only read-only audit log
  actions.ts                    # uploadSop, updateSop, deleteSop (call RPCs)
src/components/
  app-header.tsx                # NEW — shared Dashboard / SOPs tabs
  sops-list.tsx                 # role-driven list
  sop-upload-form.tsx           # form used in modal
  sop-viewer.tsx                # iframe + download button
  sop-audit-table.tsx           # NEW — paginated audit results
  sop-audit-filters.tsx         # NEW — filter bar
src/lib/sops/
  convert.ts                    # convertDocxToPdf
  convert.test.ts
  storage.ts                    # signed URL helpers, path builders
  storage.test.ts
  audit.ts                      # NEW — buildAuditSummary, filter helpers
  audit.test.ts                 # NEW
src/lib/supabase/
  queries.ts                    # extend with getSops, getSopById, getSopAuditLog
supabase/migrations/
  012_sops.sql                  # table + enum + indexes + RLS + storage policies
  013_sop_audit_log.sql         # audit table + enum + RLS + REVOKE + trigger + RPCs
```

## Testing

- **Unit**: `convert.ts` with `spawn` mocked (covers timeout, non-zero exit, missing output file, success path); storage path builders; query helpers' audience filter logic; `buildAuditSummary` for each action type.
- **Integration**: `actions.ts` round-trip — upload PDF (asserts both `sops` row and `upload` audit row exist), edit metadata only (asserts `edit_metadata` audit row), edit visibility (asserts `visibility_change` row), replace file (asserts `replace_file` row + that previous storage object still exists), delete (asserts `sops` row gone, `delete` audit row exists, storage object still exists). DOCX integration test runs only when `soffice` is available locally; otherwise skips with a clear message.
- **Access control**: tests that an EPO session cannot SELECT a `management_only` SOP, cannot SELECT any `sop_audit_log` row, the Upload button doesn't render in EPO sessions, calling `uploadSop` from an EPO session returns unauthorized, and `/sops/audit` redirects EPOs.
- **Immutability**: a database-level test that any direct UPDATE or DELETE against `sop_audit_log` fails — both via the `service_role` REST endpoint (privilege check) and via direct SQL as the table owner (trigger check).

## Deploy Prerequisites

LibreOffice headless must be installed on Clipper before this feature is deployed:

```bash
ssh clipper "sudo zypper install -y libreoffice"
ssh clipper "soffice --version"   # confirm the app's runtime user can invoke it
```

This is a one-time install and does not need to be re-run on subsequent deploys. Without it, DOCX uploads will fail with a clear error; PDF uploads will continue to work.

## Mobile

The SOPs list collapses to single-column cards on narrow viewports, mirroring the dashboard's mobile pattern. The viewer's iframe renders full-width; "Download original" is the primary mobile action. Upload from mobile is supported but not optimized — file pickers vary across mobile browsers and we do not work around platform quirks here.
