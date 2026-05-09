# SOPs Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an in-app library of Standard Operating Procedures with role-aware access (managers upload PDF/DOCX, EPOs view shared SOPs), server-side DOCX→PDF conversion via LibreOffice on Clipper, and an immutable, append-only audit log of every mutation.

**Architecture:** Two Postgres tables (`sops` for current state, `sop_audit_log` for append-only history) with RLS gating audience visibility. Storage paths are versioned per upload and never deleted, so the audit log can reproduce any past file. Server actions call `security definer` PL/pgSQL RPC functions that wrap each live mutation and its audit insert in a single transaction. A new `/SecApp/sops` route hosts a role-aware list, dedicated viewer, upload modal, and a separate management-only `/sops/audit` page.

**Tech Stack:** Next.js 16 (standalone, basePath `/SecApp`), React 19, TypeScript strict, Tailwind v4, Supabase (Postgres + Storage + Auth + RLS), `bun test` for unit/integration tests, `soffice --headless` (LibreOffice) on Clipper for DOCX conversion.

**Spec:** `docs/superpowers/specs/2026-05-08-sops-feature-design.md`

---

## Conventions used throughout this plan

- **Test framework:** `bun test`. Imports come from `bun:test` (e.g. `import { describe, expect, test } from "bun:test"`).
- **Path alias:** `@/*` maps to `src/*` per `tsconfig.json`.
- **Action testability pattern:** match the existing pattern in `src/app/dashboard/actions.ts` — export a private `_actionForTest(args, factory, now, deps?)` and a thin public `action(args)` wrapper that supplies the real `createClient()` + `new Date()`. Tests target the inner function with hand-rolled supabase stubs.
- **Run the unit test for a single file:** `bun test src/lib/sops/convert.test.ts`.
- **Run all tests:** `bun test`.
- **Type-check + build:** `bun run build` (catches TS errors and Next.js route issues).
- **Lint:** `bun run lint`.
- **Dev server:** `bun run dev` — served at `http://localhost:3000/SecApp`.
- **Commit one task at a time.** Each task ends in a `git add <files>` + `git commit` step. Never `git add .`.
- **Migrations are run by AJ in the Supabase SQL editor.** Tasks producing migrations end after committing the file; they do not "apply" the migration locally.

---

## Task 1: Migration 012 — `sops` table, enum, RLS, storage bucket, storage policies

**Files:**
- Create: `supabase/migrations/012_sops.sql`

- [ ] **Step 1: Create the migration file**

Write the full SQL in one go. No tests at this layer — schema correctness will be validated by integration tests in later tasks. The file:

```sql
-- 012_sops.sql
-- SOPs library: current state of every SOP plus storage bucket + RLS.
-- The audit log lives in 013_sop_audit_log.sql.

-- Enum for the two visibility classes.
create type sop_audience as enum ('shared', 'management_only');

-- One row per SOP. Replaced files do not produce new rows; the row's
-- storage paths are updated and the audit log records the supersession.
create table sops (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  audience sop_audience not null,
  storage_path_pdf text not null,         -- always present; what the viewer loads
  storage_path_original text not null,    -- PDF or DOCX; what download serves
  original_filename text not null,
  original_mime_type text not null,       -- 'application/pdf' or DOCX MIME
  file_size_bytes bigint not null,
  uploaded_by uuid not null references profiles(id),
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_sops_audience on sops(audience);
create index idx_sops_uploaded_at on sops(uploaded_at desc);

-- RLS: management sees all rows; EPO sees only shared.
alter table sops enable row level security;

create policy "Management can read all sops"
  on sops for select
  using (is_management());

create policy "EPO can read shared sops"
  on sops for select
  using (
    not is_management()
    and audience = 'shared'
  );

create policy "Management can insert sops"
  on sops for insert
  with check (is_management());

create policy "Management can update sops"
  on sops for update
  using (is_management())
  with check (is_management());

create policy "Management can delete sops"
  on sops for delete
  using (is_management());

-- Storage bucket. Private (no public URL); access goes through signed URLs
-- generated server-side after the RLS check passes.
insert into storage.buckets (id, name, public)
values ('sops', 'sops', false)
on conflict (id) do nothing;

-- Storage path layout: <sopId>/<uploadSlug>/{original.{pdf,docx},document.pdf}
-- A path's <sopId> segment is the first path component. Read access for an
-- EPO requires that segment to match a sop row whose audience='shared' AND
-- whose storage_path_pdf or storage_path_original ends with this object's
-- name (so historical paths from the audit log are NOT readable to EPOs).

create policy "Management can read all sop storage objects"
  on storage.objects for select
  using (
    bucket_id = 'sops'
    and is_management()
  );

create policy "EPO can read current shared sop storage objects"
  on storage.objects for select
  using (
    bucket_id = 'sops'
    and not is_management()
    and exists (
      select 1
      from sops
      where audience = 'shared'
        and (storage_path_pdf = storage.objects.name
             or storage_path_original = storage.objects.name)
    )
  );

create policy "Management can write sop storage objects"
  on storage.objects for insert
  with check (
    bucket_id = 'sops'
    and is_management()
  );

create policy "Management can update sop storage objects"
  on storage.objects for update
  using (
    bucket_id = 'sops'
    and is_management()
  );

-- No DELETE policy on storage.objects for the sops bucket: storage objects
-- are intentionally never deleted by the application so the audit log can
-- reproduce any past file.
```

- [ ] **Step 2: Sanity-check the SQL by reading it end-to-end**

Look for typos, mismatched policy names, missing semicolons. Verify `is_management()` is referenced (it exists in `001_initial_schema.sql`). Verify `profiles` is referenced (it exists). Verify `storage.objects` and `storage.buckets` references — those are Supabase-provided.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/012_sops.sql
git commit -m "feat(sops): add 012_sops migration (table + RLS + storage bucket)"
```

---

## Task 2: Migration 013 — `sop_audit_log`, immutability, RPC functions

**Files:**
- Create: `supabase/migrations/013_sop_audit_log.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 013_sop_audit_log.sql
-- Append-only audit log for every SOP mutation. Three immutability layers:
--   1. RLS denies UPDATE/DELETE (no policies for those operations).
--   2. Privileges revoked from API roles so even RLS-bypassing service_role
--      cannot mutate via the REST API.
--   3. Triggers raise on UPDATE/DELETE as defense in depth (catches owner-
--      role direct SQL or future privilege regrants).
--
-- Live mutations are wrapped together with their audit insert in
-- security-definer RPC functions so the live row + audit row are atomic.

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
  sop_id uuid not null,                   -- NOT a FK; survives sop deletion
  action sop_audit_action not null,

  -- Snapshot at time of action.
  title_at_action text not null,
  audience_at_action sop_audience not null,

  -- File context.
  new_storage_path text,
  new_filename text,
  new_mime_type text,
  new_file_size_bytes bigint,
  superseded_storage_path text,
  superseded_filename text,

  -- Metadata diffs.
  prev_title text,
  prev_description text,
  next_description text,
  prev_audience sop_audience
);

create index idx_sop_audit_sop_id on sop_audit_log(sop_id, occurred_at desc);
create index idx_sop_audit_occurred_at on sop_audit_log(occurred_at desc);
create index idx_sop_audit_title_trgm
  on sop_audit_log using gin (title_at_action gin_trgm_ops);

-- Layer 1: RLS — read for management; no INSERT/UPDATE/DELETE policy means
-- those operations are denied for all non-bypassing roles.
alter table sop_audit_log enable row level security;

create policy "Management can read audit log"
  on sop_audit_log for select using (is_management());

-- Layer 2: Revoke privileges so service_role (which bypasses RLS) cannot
-- write either. Only the function owner (postgres) retains rights, which
-- the SECURITY DEFINER RPC functions below run with.
revoke all on sop_audit_log from anon, authenticated, service_role;
grant select on sop_audit_log to authenticated;

-- Layer 3: Triggers as defense in depth.
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

-- ---------------------------------------------------------------------
-- RPC functions: each wraps a live mutation + its audit insert(s) in a
-- single transaction. SECURITY DEFINER lets them write to sop_audit_log
-- despite the API-role privilege revocation. Each function calls
-- is_management() as a second auth gate.
-- ---------------------------------------------------------------------

create or replace function record_sop_upload(
  p_sop_id uuid,
  p_title text,
  p_description text,
  p_audience sop_audience,
  p_storage_path_pdf text,
  p_storage_path_original text,
  p_original_filename text,
  p_original_mime_type text,
  p_file_size_bytes bigint,
  p_actor_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_management() then
    raise exception 'unauthorized';
  end if;

  insert into sops (
    id, title, description, audience,
    storage_path_pdf, storage_path_original,
    original_filename, original_mime_type, file_size_bytes,
    uploaded_by
  ) values (
    p_sop_id, p_title, p_description, p_audience,
    p_storage_path_pdf, p_storage_path_original,
    p_original_filename, p_original_mime_type, p_file_size_bytes,
    p_actor_id
  );

  insert into sop_audit_log (
    actor_id, sop_id, action,
    title_at_action, audience_at_action,
    new_storage_path, new_filename, new_mime_type, new_file_size_bytes
  ) values (
    p_actor_id, p_sop_id, 'upload',
    p_title, p_audience,
    p_storage_path_pdf, p_original_filename, p_original_mime_type, p_file_size_bytes
  );
end;
$$;

-- Update RPC: takes the new desired state, reads the current row, computes
-- diffs, writes the row update, and inserts one audit row per change type
-- (edit_metadata, visibility_change, replace_file).
--
-- File-replacement params are nullable: callers pass them only when a new
-- file was uploaded. If null, the file fields are not updated and no
-- replace_file audit row is written.
create or replace function record_sop_update(
  p_sop_id uuid,
  p_actor_id uuid,
  p_new_title text,
  p_new_description text,
  p_new_audience sop_audience,
  p_new_storage_path_pdf text,
  p_new_storage_path_original text,
  p_new_original_filename text,
  p_new_original_mime_type text,
  p_new_file_size_bytes bigint
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current sops%rowtype;
  v_metadata_changed boolean := false;
  v_audience_changed boolean := false;
  v_file_changed boolean := false;
begin
  if not is_management() then
    raise exception 'unauthorized';
  end if;

  select * into v_current from sops where id = p_sop_id for update;
  if not found then
    raise exception 'sop not found';
  end if;

  v_metadata_changed := v_current.title is distinct from p_new_title
    or v_current.description is distinct from p_new_description;
  v_audience_changed := v_current.audience is distinct from p_new_audience;
  v_file_changed := p_new_storage_path_pdf is not null;

  update sops set
    title = p_new_title,
    description = p_new_description,
    audience = p_new_audience,
    storage_path_pdf = coalesce(p_new_storage_path_pdf, storage_path_pdf),
    storage_path_original = coalesce(p_new_storage_path_original, storage_path_original),
    original_filename = coalesce(p_new_original_filename, original_filename),
    original_mime_type = coalesce(p_new_original_mime_type, original_mime_type),
    file_size_bytes = coalesce(p_new_file_size_bytes, file_size_bytes),
    updated_at = now()
  where id = p_sop_id;

  if v_metadata_changed then
    insert into sop_audit_log (
      actor_id, sop_id, action, title_at_action, audience_at_action,
      prev_title, prev_description, next_description
    ) values (
      p_actor_id, p_sop_id, 'edit_metadata', p_new_title, p_new_audience,
      v_current.title, v_current.description, p_new_description
    );
  end if;

  if v_audience_changed then
    insert into sop_audit_log (
      actor_id, sop_id, action, title_at_action, audience_at_action,
      prev_audience
    ) values (
      p_actor_id, p_sop_id, 'visibility_change', p_new_title, p_new_audience,
      v_current.audience
    );
  end if;

  if v_file_changed then
    insert into sop_audit_log (
      actor_id, sop_id, action, title_at_action, audience_at_action,
      new_storage_path, new_filename, new_mime_type, new_file_size_bytes,
      superseded_storage_path, superseded_filename
    ) values (
      p_actor_id, p_sop_id, 'replace_file', p_new_title, p_new_audience,
      p_new_storage_path_pdf, p_new_original_filename, p_new_original_mime_type, p_new_file_size_bytes,
      v_current.storage_path_pdf, v_current.original_filename
    );
  end if;
end;
$$;

create or replace function record_sop_delete(
  p_sop_id uuid,
  p_actor_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current sops%rowtype;
begin
  if not is_management() then
    raise exception 'unauthorized';
  end if;

  select * into v_current from sops where id = p_sop_id for update;
  if not found then
    raise exception 'sop not found';
  end if;

  insert into sop_audit_log (
    actor_id, sop_id, action, title_at_action, audience_at_action,
    superseded_storage_path, superseded_filename
  ) values (
    p_actor_id, p_sop_id, 'delete', v_current.title, v_current.audience,
    v_current.storage_path_pdf, v_current.original_filename
  );

  delete from sops where id = p_sop_id;
end;
$$;

-- Allow API roles to call the RPCs (they execute as the function owner).
grant execute on function record_sop_upload(uuid, text, text, sop_audience, text, text, text, text, bigint, uuid) to authenticated;
grant execute on function record_sop_update(uuid, uuid, text, text, sop_audience, text, text, text, text, bigint) to authenticated;
grant execute on function record_sop_delete(uuid, uuid) to authenticated;
```

- [ ] **Step 2: Re-read end-to-end**

Verify: enum referenced before use; `is_management()` referenced (exists from migration 001); RPC parameter lists match the GRANT EXECUTE signatures exactly (function overloading by argument types); audit triggers fire BEFORE so the operation is blocked before it touches the row.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/013_sop_audit_log.sql
git commit -m "feat(sops): add 013_sop_audit_log migration (table + immutability + RPCs)"
```

---

## Task 3: SOP TypeScript types

**Files:**
- Create: `src/types/sops.ts`

- [ ] **Step 1: Create the types file**

```ts
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
```

- [ ] **Step 2: Type-check**

Run: `bun run lint`
Expected: no errors related to `src/types/sops.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/types/sops.ts
git commit -m "feat(sops): add domain types for sops + audit log"
```

---

## Task 4: Storage path module

**Files:**
- Create: `src/lib/sops/storage.ts`
- Create: `src/lib/sops/storage.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/sops/storage.test.ts
import { describe, expect, test } from "bun:test";
import {
  buildUploadSlug,
  buildOriginalPath,
  buildPdfPath,
  SOPS_BUCKET,
} from "./storage";

describe("buildUploadSlug", () => {
  test("formats UTC timestamp as YYYYMMDDTHHMMSSZ with no separators", () => {
    const d = new Date("2026-05-08T14:32:11.123Z");
    expect(buildUploadSlug(d)).toBe("20260508T143211Z");
  });

  test("zero-pads single-digit components", () => {
    const d = new Date("2026-01-02T03:04:05.000Z");
    expect(buildUploadSlug(d)).toBe("20260102T030405Z");
  });

  test("uses UTC regardless of local timezone", () => {
    // The Date constructor parses 'Z' as UTC; getUTC* methods stay UTC,
    // so the slug is timezone-independent. This guards against a future
    // refactor that switches to getHours()/getMonth() etc.
    const d = new Date("2026-05-08T23:59:59Z");
    expect(buildUploadSlug(d)).toBe("20260508T235959Z");
  });
});

describe("buildOriginalPath / buildPdfPath", () => {
  test("original path includes sop id, slug, and extension", () => {
    expect(buildOriginalPath("abc-123", "20260508T143211Z", "docx")).toBe(
      "abc-123/20260508T143211Z/original.docx"
    );
    expect(buildOriginalPath("abc-123", "20260508T143211Z", "pdf")).toBe(
      "abc-123/20260508T143211Z/original.pdf"
    );
  });

  test("pdf path always uses document.pdf", () => {
    expect(buildPdfPath("abc-123", "20260508T143211Z")).toBe(
      "abc-123/20260508T143211Z/document.pdf"
    );
  });
});

describe("SOPS_BUCKET", () => {
  test("matches the bucket id from migration 012", () => {
    expect(SOPS_BUCKET).toBe("sops");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/sops/storage.test.ts`
Expected: module not found / import errors.

- [ ] **Step 3: Implement the module**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/sops/storage.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sops/storage.ts src/lib/sops/storage.test.ts
git commit -m "feat(sops): add storage path builders with tests"
```

---

## Task 5: DOCX → PDF conversion module

**Files:**
- Create: `src/lib/sops/convert.ts`
- Create: `src/lib/sops/convert.test.ts`

The module shells out to `soffice` (LibreOffice headless). Tests mock the spawn function via dependency injection so they pass without LibreOffice installed.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/sops/convert.test.ts
import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { writeFile } from "node:fs/promises";
import { convertDocxToPdf, DocxConversionError } from "./convert";

// Build a fake ChildProcess that exposes the surface convert.ts uses:
// stderr emitter + 'error' event + 'exit' event + .kill().
function fakeChild(opts: {
  exitCode?: number | null;
  errorAfterMs?: number;
  exitAfterMs?: number;
  stderr?: string;
  noEvents?: boolean;
}) {
  const child = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter;
    kill: (sig?: NodeJS.Signals | number) => void;
    killed: boolean;
  };
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };

  if (opts.noEvents) return child;

  setTimeout(() => {
    if (opts.stderr) child.stderr.emit("data", Buffer.from(opts.stderr));
    if (opts.errorAfterMs !== undefined) {
      child.emit("error", new Error("spawn failed"));
    } else {
      child.emit("exit", opts.exitCode ?? 0);
    }
  }, opts.exitAfterMs ?? opts.errorAfterMs ?? 0);

  return child;
}

describe("convertDocxToPdf", () => {
  test("returns the PDF bytes that LibreOffice writes to outdir", async () => {
    let capturedOutdir: string | null = null;

    const result = await convertDocxToPdf(Buffer.from("fake docx bytes"), {
      spawn: ((_cmd: string, args: string[]) => {
        // args = [--headless, --convert-to, pdf, --outdir, <dir>, <input>]
        capturedOutdir = args[4];
        const inputPath = args[5];
        const outputPath = inputPath.replace(/\.docx$/, ".pdf");
        const fake = fakeChild({ noEvents: true });
        // Simulate soffice writing the output PDF, then exit.
        setImmediate(async () => {
          await writeFile(outputPath, Buffer.from("PDF bytes"));
          setImmediate(() => fake.emit("exit", 0));
        });
        return fake as unknown as ReturnType<typeof import("node:child_process").spawn>;
      }) as typeof import("node:child_process").spawn,
    });

    expect(result.toString()).toBe("PDF bytes");
    expect(capturedOutdir).not.toBeNull();
  });

  test("rejects with DocxConversionError on non-zero exit", async () => {
    await expect(
      convertDocxToPdf(Buffer.from("bad"), {
        spawn: ((() =>
          fakeChild({
            exitCode: 1,
            stderr: "soffice: source file is corrupt",
          })) as unknown) as typeof import("node:child_process").spawn,
      })
    ).rejects.toBeInstanceOf(DocxConversionError);
  });

  test("rejects with DocxConversionError when spawn errors", async () => {
    await expect(
      convertDocxToPdf(Buffer.from("bad"), {
        spawn: ((() =>
          fakeChild({ errorAfterMs: 0 })) as unknown) as typeof import("node:child_process").spawn,
      })
    ).rejects.toBeInstanceOf(DocxConversionError);
  });

  test("kills the child and rejects on timeout", async () => {
    let killed = false;
    await expect(
      convertDocxToPdf(Buffer.from("hang"), {
        spawn: ((() => {
          const f = fakeChild({ noEvents: true });
          const origKill = f.kill;
          f.kill = (sig) => {
            killed = true;
            origKill(sig);
          };
          return f as unknown as ReturnType<
            typeof import("node:child_process").spawn
          >;
        }) as unknown) as typeof import("node:child_process").spawn,
        timeoutMs: 5,
      })
    ).rejects.toBeInstanceOf(DocxConversionError);
    expect(killed).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/sops/convert.test.ts`
Expected: import errors / module not found.

- [ ] **Step 3: Implement the module**

```ts
// src/lib/sops/convert.ts
// Server-side DOCX → PDF conversion using LibreOffice headless. Used by
// the SOP upload action when the manager uploads a DOCX.
//
// Requires `soffice` on PATH on the runtime host (see docs/CLIPPER.md).

import { spawn as nodeSpawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class DocxConversionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "DocxConversionError";
  }
}

export interface ConvertDeps {
  spawn?: typeof nodeSpawn;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export async function convertDocxToPdf(
  input: Buffer,
  deps: ConvertDeps = {}
): Promise<Buffer> {
  const spawn = deps.spawn ?? nodeSpawn;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const workDir = await mkdtemp(join(tmpdir(), "sop-convert-"));
  const inputPath = join(workDir, "input.docx");
  const outputPath = join(workDir, "input.pdf");

  await writeFile(inputPath, input);

  try {
    await runSoffice(spawn, workDir, inputPath, timeoutMs);
    return await readFile(outputPath);
  } catch (err) {
    if (err instanceof DocxConversionError) throw err;
    throw new DocxConversionError("DOCX conversion failed", err);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function runSoffice(
  spawn: typeof nodeSpawn,
  workDir: string,
  inputPath: string,
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "soffice",
      ["--headless", "--convert-to", "pdf", "--outdir", workDir, inputPath],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    let stderrBuf = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new DocxConversionError(`LibreOffice timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new DocxConversionError("Failed to spawn soffice", err));
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(
          new DocxConversionError(
            `soffice exited with code ${code}${stderrBuf ? `: ${stderrBuf.trim()}` : ""}`
          )
        );
      }
    });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/sops/convert.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sops/convert.ts src/lib/sops/convert.test.ts
git commit -m "feat(sops): add DOCX-to-PDF converter via LibreOffice headless"
```

---

## Task 6: Audit summary builder

**Files:**
- Create: `src/lib/sops/audit.ts`
- Create: `src/lib/sops/audit.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/sops/audit.test.ts
import { describe, expect, test } from "bun:test";
import type { SopAuditLogEntry } from "@/types/sops";
import { buildAuditSummary } from "./audit";

function makeEntry(overrides: Partial<SopAuditLogEntry>): SopAuditLogEntry {
  return {
    id: "entry-1",
    occurredAt: "2026-05-08T14:32:11Z",
    actorId: "actor-1",
    sopId: "sop-1",
    action: "upload",
    titleAtAction: "Boarding Procedure",
    audienceAtAction: "shared",
    newStoragePath: null,
    newFilename: null,
    newMimeType: null,
    newFileSizeBytes: null,
    supersededStoragePath: null,
    supersededFilename: null,
    prevTitle: null,
    prevDescription: null,
    nextDescription: null,
    prevAudience: null,
    ...overrides,
  };
}

describe("buildAuditSummary", () => {
  test("upload includes filename and audience label", () => {
    expect(
      buildAuditSummary(
        makeEntry({
          action: "upload",
          newFilename: "procedure-v2.pdf",
          audienceAtAction: "shared",
        })
      )
    ).toBe("Uploaded procedure-v2.pdf (Shared)");
  });

  test("upload uses 'Management only' label when audience is management_only", () => {
    expect(
      buildAuditSummary(
        makeEntry({
          action: "upload",
          newFilename: "internal.pdf",
          audienceAtAction: "management_only",
        })
      )
    ).toBe("Uploaded internal.pdf (Management only)");
  });

  test("replace_file shows superseded → new", () => {
    expect(
      buildAuditSummary(
        makeEntry({
          action: "replace_file",
          newFilename: "procedure-v2.pdf",
          supersededFilename: "procedure-v1.pdf",
        })
      )
    ).toBe("Replaced procedure-v1.pdf with procedure-v2.pdf");
  });

  test("edit_metadata renders title diff", () => {
    expect(
      buildAuditSummary(
        makeEntry({
          action: "edit_metadata",
          titleAtAction: "New Title",
          prevTitle: "Old Title",
          prevDescription: "old desc",
          nextDescription: "old desc",
        })
      )
    ).toBe('Title: "Old Title" → "New Title"');
  });

  test("edit_metadata reports description-only change", () => {
    expect(
      buildAuditSummary(
        makeEntry({
          action: "edit_metadata",
          titleAtAction: "Same Title",
          prevTitle: "Same Title",
          prevDescription: "old desc",
          nextDescription: "new desc",
        })
      )
    ).toBe("Description updated");
  });

  test("edit_metadata combines title and description changes", () => {
    expect(
      buildAuditSummary(
        makeEntry({
          action: "edit_metadata",
          titleAtAction: "New Title",
          prevTitle: "Old Title",
          prevDescription: "old desc",
          nextDescription: "new desc",
        })
      )
    ).toBe('Title: "Old Title" → "New Title"; description updated');
  });

  test("visibility_change shows audience transition", () => {
    expect(
      buildAuditSummary(
        makeEntry({
          action: "visibility_change",
          audienceAtAction: "management_only",
          prevAudience: "shared",
        })
      )
    ).toBe("Audience: Shared → Management only");
  });

  test("delete names the file in force at deletion", () => {
    expect(
      buildAuditSummary(
        makeEntry({
          action: "delete",
          supersededFilename: "procedure-v3.pdf",
        })
      )
    ).toBe("Deleted procedure-v3.pdf");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/sops/audit.test.ts`
Expected: import errors.

- [ ] **Step 3: Implement the module**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/sops/audit.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sops/audit.ts src/lib/sops/audit.test.ts
git commit -m "feat(sops): add buildAuditSummary helper with tests"
```

---

## Task 7: Query helpers

**Files:**
- Modify: `src/lib/supabase/queries.ts` (append new helpers; do NOT touch existing ones)

- [ ] **Step 1: Append the new query helpers**

Add at the end of `src/lib/supabase/queries.ts`:

```ts
// ---- SOPs ----

import type {
  Sop,
  SopAudience,
  SopAuditLogEntryWithActor,
} from "@/types/sops";

interface SopRow {
  id: string;
  title: string;
  description: string | null;
  audience: SopAudience;
  storage_path_pdf: string;
  storage_path_original: string;
  original_filename: string;
  original_mime_type: string;
  file_size_bytes: number;
  uploaded_by: string;
  uploaded_at: string;
  updated_at: string;
}

function toSop(row: SopRow): Sop {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    audience: row.audience,
    storagePathPdf: row.storage_path_pdf,
    storagePathOriginal: row.storage_path_original,
    originalFilename: row.original_filename,
    originalMimeType: row.original_mime_type,
    fileSizeBytes: row.file_size_bytes,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Returns SOPs visible to the caller's session — RLS handles the audience
 * filter. EPO sessions get only `shared` rows; management gets everything.
 */
export async function getSops(supabase: SupabaseClient): Promise<Sop[]> {
  const { data, error } = await supabase
    .from("sops")
    .select("*")
    .order("uploaded_at", { ascending: false });
  if (error) {
    console.error("getSops failed:", error.message);
    return [];
  }
  return (data ?? []).map((r) => toSop(r as SopRow));
}

export async function getSopById(
  supabase: SupabaseClient,
  id: string
): Promise<Sop | null> {
  const { data, error } = await supabase
    .from("sops")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("getSopById failed:", error.message);
    return null;
  }
  return data ? toSop(data as SopRow) : null;
}

// ---- SOP audit log ----

interface AuditRow {
  id: string;
  occurred_at: string;
  actor_id: string;
  sop_id: string;
  action: SopAuditLogEntryWithActor["action"];
  title_at_action: string;
  audience_at_action: SopAudience;
  new_storage_path: string | null;
  new_filename: string | null;
  new_mime_type: string | null;
  new_file_size_bytes: number | null;
  superseded_storage_path: string | null;
  superseded_filename: string | null;
  prev_title: string | null;
  prev_description: string | null;
  next_description: string | null;
  prev_audience: SopAudience | null;
  actor: { full_name: string | null; email: string } | null;
}

function toAudit(row: AuditRow): SopAuditLogEntryWithActor {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    actorId: row.actor_id,
    sopId: row.sop_id,
    action: row.action,
    titleAtAction: row.title_at_action,
    audienceAtAction: row.audience_at_action,
    newStoragePath: row.new_storage_path,
    newFilename: row.new_filename,
    newMimeType: row.new_mime_type,
    newFileSizeBytes: row.new_file_size_bytes,
    supersededStoragePath: row.superseded_storage_path,
    supersededFilename: row.superseded_filename,
    prevTitle: row.prev_title,
    prevDescription: row.prev_description,
    nextDescription: row.next_description,
    prevAudience: row.prev_audience,
    actorFullName: row.actor?.full_name ?? "",
    actorEmail: row.actor?.email ?? "",
  };
}

export interface AuditFilters {
  sopId?: string;
  actorId?: string;
  actions?: SopAuditLogEntryWithActor["action"][];
  titleQuery?: string;
  startDate?: string; // YYYY-MM-DD inclusive
  endDate?: string;   // YYYY-MM-DD inclusive
  limit?: number;
  offset?: number;
}

export async function getSopAuditLog(
  supabase: SupabaseClient,
  filters: AuditFilters = {}
): Promise<{ entries: SopAuditLogEntryWithActor[]; totalCount: number }> {
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  let query = supabase
    .from("sop_audit_log")
    .select(
      "*, actor:actor_id(full_name, email)",
      { count: "exact" }
    )
    .order("occurred_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.sopId) query = query.eq("sop_id", filters.sopId);
  if (filters.actorId) query = query.eq("actor_id", filters.actorId);
  if (filters.actions && filters.actions.length > 0) {
    query = query.in("action", filters.actions);
  }
  if (filters.titleQuery) {
    // pg_trgm-backed substring match (% is the SQL LIKE wildcard)
    query = query.ilike("title_at_action", `%${filters.titleQuery}%`);
  }
  if (filters.startDate) {
    query = query.gte("occurred_at", `${filters.startDate}T00:00:00Z`);
  }
  if (filters.endDate) {
    query = query.lte("occurred_at", `${filters.endDate}T23:59:59Z`);
  }

  const { data, error, count } = await query;
  if (error) {
    console.error("getSopAuditLog failed:", error.message);
    return { entries: [], totalCount: 0 };
  }
  return {
    entries: (data ?? []).map((r) => toAudit(r as AuditRow)),
    totalCount: count ?? 0,
  };
}

export async function listManagementProfiles(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("role", "management")
    .order("full_name");
  if (error) {
    console.error("listManagementProfiles failed:", error.message);
    return [];
  }
  return data ?? [];
}
```

- [ ] **Step 2: Type-check**

Run: `bun run lint`
Expected: no errors.

Note: there are no unit tests for these helpers — they're thin wrappers around Supabase calls and will be exercised end-to-end by the integration tests in Task 18.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase/queries.ts
git commit -m "feat(sops): add getSops/getSopById/getSopAuditLog query helpers"
```

---

## Task 8: `uploadSop` server action

**Files:**
- Create: `src/app/sops/actions.ts`
- Create: `src/app/sops/actions.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/sops/actions.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { _uploadSopForTest } from "./actions";

function makeFormData(file: File, fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append("file", file);
  return fd;
}

function pdfFile(name = "ops.pdf", size = 1024) {
  return new File([new Uint8Array(size)], name, { type: "application/pdf" });
}

function makeStubSupabase(opts: {
  user?: { id: string } | null;
  rpcResult?: { error: { message: string } | null };
  uploadResult?: { error: { message: string } | null };
  removeResult?: { error: { message: string } | null };
} = {}) {
  const calls = {
    rpc: [] as { name: string; args: Record<string, unknown> }[],
    uploadPaths: [] as string[],
    removedPaths: [] as string[],
  };
  return {
    calls,
    client: {
      auth: {
        getUser: async () => ({
          data: { user: opts.user ?? { id: "mgr-1" } },
        }),
      },
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.rpc.push({ name, args });
        return opts.rpcResult ?? { error: null };
      },
      storage: {
        from: () => ({
          upload: async (path: string) => {
            calls.uploadPaths.push(path);
            return opts.uploadResult ?? { error: null };
          },
          remove: async (paths: string[]) => {
            calls.removedPaths.push(...paths);
            return opts.removeResult ?? { error: null };
          },
        }),
      },
    },
  };
}

describe("_uploadSopForTest", () => {
  test("rejects unauthenticated callers", async () => {
    const stub = makeStubSupabase({ user: null });
    const result = await _uploadSopForTest(
      makeFormData(pdfFile(), { title: "T", audience: "shared" }),
      () => stub.client,
      new Date("2026-05-08T14:32:11Z")
    );
    expect(result.ok).toBe(false);
    expect(stub.calls.uploadPaths).toEqual([]);
    expect(stub.calls.rpc).toEqual([]);
  });

  test("rejects when title is missing", async () => {
    const stub = makeStubSupabase();
    const result = await _uploadSopForTest(
      makeFormData(pdfFile(), { title: "  ", audience: "shared" }),
      () => stub.client,
      new Date("2026-05-08T14:32:11Z")
    );
    expect(result.ok).toBe(false);
    expect(stub.calls.uploadPaths).toEqual([]);
  });

  test("rejects unsupported file types", async () => {
    const stub = makeStubSupabase();
    const txt = new File(["x"], "notes.txt", { type: "text/plain" });
    const result = await _uploadSopForTest(
      makeFormData(txt, { title: "T", audience: "shared" }),
      () => stub.client,
      new Date("2026-05-08T14:32:11Z")
    );
    expect(result.ok).toBe(false);
    expect(stub.calls.uploadPaths).toEqual([]);
  });

  test("rejects oversize files", async () => {
    const stub = makeStubSupabase();
    const big = pdfFile("big.pdf", 26 * 1024 * 1024);
    const result = await _uploadSopForTest(
      makeFormData(big, { title: "T", audience: "shared" }),
      () => stub.client,
      new Date("2026-05-08T14:32:11Z")
    );
    expect(result.ok).toBe(false);
    expect(stub.calls.uploadPaths).toEqual([]);
  });

  test("PDF upload: stores one file and calls record_sop_upload RPC", async () => {
    const stub = makeStubSupabase();
    const result = await _uploadSopForTest(
      makeFormData(pdfFile(), { title: "Boarding", audience: "shared" }),
      () => stub.client,
      new Date("2026-05-08T14:32:11Z")
    );
    expect(result.ok).toBe(true);
    expect(stub.calls.uploadPaths).toHaveLength(1);
    expect(stub.calls.uploadPaths[0]).toMatch(
      /^[0-9a-f-]+\/20260508T143211Z\/original\.pdf$/
    );
    expect(stub.calls.rpc).toHaveLength(1);
    expect(stub.calls.rpc[0].name).toBe("record_sop_upload");
    const args = stub.calls.rpc[0].args;
    expect(args.p_title).toBe("Boarding");
    expect(args.p_audience).toBe("shared");
    expect(args.p_actor_id).toBe("mgr-1");
    expect(args.p_storage_path_pdf).toBe(args.p_storage_path_original);
  });

  test("rolls back the storage upload when the RPC fails", async () => {
    const stub = makeStubSupabase({
      rpcResult: { error: { message: "rpc exploded" } },
    });
    const result = await _uploadSopForTest(
      makeFormData(pdfFile(), { title: "Boarding", audience: "shared" }),
      () => stub.client,
      new Date("2026-05-08T14:32:11Z")
    );
    expect(result.ok).toBe(false);
    expect(stub.calls.uploadPaths).toHaveLength(1);
    expect(stub.calls.removedPaths).toEqual(stub.calls.uploadPaths);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/app/sops/actions.test.ts`
Expected: import error / module missing.

- [ ] **Step 3: Implement `uploadSop`**

```ts
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
  DOCX_MIME,
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/app/sops/actions.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/sops/actions.ts src/app/sops/actions.test.ts
git commit -m "feat(sops): add uploadSop server action with rollback on failure"
```

---

## Task 9: `updateSop` server action

**Files:**
- Modify: `src/app/sops/actions.ts` (append)
- Modify: `src/app/sops/actions.test.ts` (append)

- [ ] **Step 1: Add the failing tests**

Append to `src/app/sops/actions.test.ts`:

```ts
import { _updateSopForTest } from "./actions";

function makeUpdateStub(opts: {
  user?: { id: string } | null;
  currentSop?: {
    id: string;
    storage_path_pdf: string;
    storage_path_original: string;
    original_filename: string;
    original_mime_type: string;
  } | null;
  rpcResult?: { error: { message: string } | null };
} = {}) {
  const calls = {
    rpc: [] as { name: string; args: Record<string, unknown> }[],
    uploadPaths: [] as string[],
  };
  return {
    calls,
    client: {
      auth: {
        getUser: async () => ({ data: { user: opts.user ?? { id: "mgr-1" } } }),
      },
      from: (_table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: opts.currentSop ?? null,
              error: null,
            }),
          }),
        }),
      }),
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.rpc.push({ name, args });
        return opts.rpcResult ?? { error: null };
      },
      storage: {
        from: () => ({
          upload: async (path: string) => {
            calls.uploadPaths.push(path);
            return { error: null };
          },
          remove: async () => ({ error: null }),
        }),
      },
    },
  };
}

describe("_updateSopForTest", () => {
  test("metadata-only update calls record_sop_update without uploading", async () => {
    const stub = makeUpdateStub({
      currentSop: {
        id: "sop-1",
        storage_path_pdf: "sop-1/old/document.pdf",
        storage_path_original: "sop-1/old/original.pdf",
        original_filename: "old.pdf",
        original_mime_type: "application/pdf",
      },
    });
    const fd = new FormData();
    fd.append("title", "New Title");
    fd.append("description", "Now described");
    fd.append("audience", "shared");
    // No file

    const result = await _updateSopForTest(
      "sop-1",
      fd,
      () => stub.client,
      new Date("2026-05-08T14:32:11Z")
    );

    expect(result.ok).toBe(true);
    expect(stub.calls.uploadPaths).toEqual([]);
    expect(stub.calls.rpc).toHaveLength(1);
    expect(stub.calls.rpc[0].name).toBe("record_sop_update");
    expect(stub.calls.rpc[0].args.p_new_storage_path_pdf).toBeNull();
  });

  test("file replacement uploads to new slug and passes storage args to RPC", async () => {
    const stub = makeUpdateStub({
      currentSop: {
        id: "sop-1",
        storage_path_pdf: "sop-1/old/document.pdf",
        storage_path_original: "sop-1/old/original.pdf",
        original_filename: "old.pdf",
        original_mime_type: "application/pdf",
      },
    });
    const fd = new FormData();
    fd.append("title", "New Title");
    fd.append("description", "");
    fd.append("audience", "shared");
    fd.append("file", pdfFile("new.pdf", 512));

    const result = await _updateSopForTest(
      "sop-1",
      fd,
      () => stub.client,
      new Date("2026-05-08T14:32:11Z")
    );

    expect(result.ok).toBe(true);
    expect(stub.calls.uploadPaths).toHaveLength(1);
    expect(stub.calls.uploadPaths[0]).toMatch(
      /^sop-1\/20260508T143211Z\/original\.pdf$/
    );
    expect(stub.calls.rpc[0].args.p_new_storage_path_pdf).toBe(
      stub.calls.uploadPaths[0]
    );
  });

  test("rejects when SOP does not exist", async () => {
    const stub = makeUpdateStub({ currentSop: null });
    const fd = new FormData();
    fd.append("title", "T");
    fd.append("description", "");
    fd.append("audience", "shared");

    const result = await _updateSopForTest(
      "missing",
      fd,
      () => stub.client,
      new Date("2026-05-08T14:32:11Z")
    );
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/app/sops/actions.test.ts`
Expected: `_updateSopForTest is not a function`.

- [ ] **Step 3: Implement `updateSop`**

Append to `src/app/sops/actions.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/app/sops/actions.test.ts`
Expected: PASS (9 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/app/sops/actions.ts src/app/sops/actions.test.ts
git commit -m "feat(sops): add updateSop server action with file-replace path"
```

---

## Task 10: `deleteSop` server action

**Files:**
- Modify: `src/app/sops/actions.ts` (append)
- Modify: `src/app/sops/actions.test.ts` (append)

- [ ] **Step 1: Add the failing test**

Append to `src/app/sops/actions.test.ts`:

```ts
import { _deleteSopForTest } from "./actions";

describe("_deleteSopForTest", () => {
  test("calls record_sop_delete RPC without removing storage objects", async () => {
    const calls = {
      rpc: [] as { name: string; args: Record<string, unknown> }[],
      removedPaths: [] as string[],
    };
    const client = {
      auth: {
        getUser: async () => ({ data: { user: { id: "mgr-1" } } }),
      },
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.rpc.push({ name, args });
        return { error: null };
      },
      storage: {
        from: () => ({
          remove: async (paths: string[]) => {
            calls.removedPaths.push(...paths);
            return { error: null };
          },
        }),
      },
    };
    const result = await _deleteSopForTest("sop-1", () => client);
    expect(result.ok).toBe(true);
    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].name).toBe("record_sop_delete");
    expect(calls.rpc[0].args).toEqual({
      p_sop_id: "sop-1",
      p_actor_id: "mgr-1",
    });
    expect(calls.removedPaths).toEqual([]);
  });

  test("returns the RPC error when the delete fails", async () => {
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: "mgr-1" } } }) },
      rpc: async () => ({ error: { message: "nope" } }),
      storage: { from: () => ({ remove: async () => ({ error: null }) }) },
    };
    const result = await _deleteSopForTest("sop-1", () => client);
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/app/sops/actions.test.ts`
Expected: `_deleteSopForTest is not a function`.

- [ ] **Step 3: Implement `deleteSop`**

Append to `src/app/sops/actions.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/app/sops/actions.test.ts`
Expected: PASS (11 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/app/sops/actions.ts src/app/sops/actions.test.ts
git commit -m "feat(sops): add deleteSop server action (storage objects preserved)"
```

---

## Task 11: Shared `<AppHeader>` with Dashboard / SOPs tabs

**Files:**
- Create: `src/components/app-header.tsx`
- Modify: `src/app/dashboard/management-dashboard.tsx` (replace inline header strip)
- Modify: `src/app/dashboard/epo-dashboard.tsx` (replace inline header strip)

The dashboard pages today render their own header. This task introduces a shared `<AppHeader>` and slots it into both dashboards.

- [ ] **Step 1: Read both dashboard files to find the header markup**

Run: `grep -n "sign out" src/app/dashboard/*.tsx` and read the surrounding lines to identify the existing header element in each file. This is needed so the tabs slot into the correct visual position.

- [ ] **Step 2: Create the AppHeader component**

```tsx
// src/components/app-header.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface AppHeaderProps {
  userName: string;
  rightSlot?: React.ReactNode; // sign-out, bug-report, etc.
}

export function AppHeader({ userName, rightSlot }: AppHeaderProps) {
  const pathname = usePathname() ?? "";
  const onDashboard = pathname.startsWith("/dashboard");
  const onSops = pathname.startsWith("/sops");

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-gray-800 bg-gray-950/95 px-3 py-2 backdrop-blur">
      <nav className="flex items-center gap-1">
        <TabLink href="/dashboard" active={onDashboard}>
          Dashboard
        </TabLink>
        <TabLink href="/sops" active={onSops}>
          SOPs
        </TabLink>
      </nav>
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <span className="hidden sm:inline">{userName}</span>
        {rightSlot}
      </div>
    </header>
  );
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-md bg-blue-900/60 px-3 py-1.5 text-sm font-medium text-blue-200"
          : "rounded-md px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-gray-100"
      }
    >
      {children}
    </Link>
  );
}
```

- [ ] **Step 3: Wire it into both dashboard pages**

In each of `src/app/dashboard/management-dashboard.tsx` and `src/app/dashboard/epo-dashboard.tsx`, locate the existing header strip (the element containing the user name and the sign-out / bug-report buttons). Replace that element with:

```tsx
<AppHeader
  userName={userName /* or profile.fullName, whichever is in scope */}
  rightSlot={
    <>
      {/* preserve the existing right-side buttons here, e.g.: */}
      <ReportBugButton />
      <SignOutButton />
    </>
  }
/>
```

Add `import { AppHeader } from "@/components/app-header";` at the top of each file.

- [ ] **Step 4: Type-check + run tests**

```bash
bun run lint
bun test
```

Expected: lint passes; all tests still pass (no test changes for this task).

- [ ] **Step 5: Manual smoke check** (run by AJ)

Run: `bun run dev`. Navigate to `/SecApp/dashboard`, confirm: header shows Dashboard tab as active, the user name and existing right-side buttons appear, the SOPs tab is visible (clicking it will 404 — that's expected; the route comes in Task 13).

- [ ] **Step 6: Commit**

```bash
git add src/components/app-header.tsx src/app/dashboard/management-dashboard.tsx src/app/dashboard/epo-dashboard.tsx
git commit -m "feat(sops): add shared AppHeader with Dashboard/SOPs tabs"
```

---

## Task 12: `<SopsList>` component (role-driven)

**Files:**
- Create: `src/components/sops-list.tsx`

Pure presentational component. It receives the SOPs and a role, and renders the right list. Click handlers and row actions are passed in by the page so this stays decoupled from server actions.

- [ ] **Step 1: Implement the component**

```tsx
// src/components/sops-list.tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import type { Sop, SopAudience } from "@/types/sops";
import { audienceLabel } from "@/lib/sops/audit";

type AudienceFilter = "all" | SopAudience;

interface SopsListProps {
  sops: Sop[];
  isManagement: boolean;
  uploadersById: Record<string, string>; // id → fullName
  onRequestUpload?: () => void;
  onRequestEdit?: (sop: Sop) => void;
  onRequestDelete?: (sop: Sop) => void;
}

export function SopsList({
  sops,
  isManagement,
  uploadersById,
  onRequestUpload,
  onRequestEdit,
  onRequestDelete,
}: SopsListProps) {
  const [audienceFilter, setAudienceFilter] = useState<AudienceFilter>("all");

  const visible = isManagement && audienceFilter !== "all"
    ? sops.filter((s) => s.audience === audienceFilter)
    : sops;

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between gap-2">
        {isManagement ? (
          <AudienceSegmented value={audienceFilter} onChange={setAudienceFilter} />
        ) : (
          <h1 className="text-lg font-semibold text-gray-100">SOPs</h1>
        )}
        {isManagement && (
          <div className="flex items-center gap-2">
            <Link
              href="/sops/audit"
              className="rounded-md px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800"
            >
              Audit log
            </Link>
            <button
              type="button"
              onClick={onRequestUpload}
              className="rounded-md bg-blue-700 px-3 py-1.5 text-sm font-medium text-blue-50 hover:bg-blue-600"
            >
              Upload SOP
            </button>
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-gray-800 bg-gray-900 p-6 text-center text-sm text-gray-400">
          {isManagement
            ? "No SOPs uploaded. Click Upload to add the first one."
            : "No SOPs available yet."}
        </p>
      ) : (
        <ul className="divide-y divide-gray-800 overflow-hidden rounded-lg border border-gray-800 bg-gray-900">
          {visible.map((sop) => (
            <SopRow
              key={sop.id}
              sop={sop}
              isManagement={isManagement}
              uploaderName={uploadersById[sop.uploadedBy] ?? ""}
              onEdit={onRequestEdit}
              onDelete={onRequestDelete}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AudienceSegmented({
  value,
  onChange,
}: {
  value: AudienceFilter;
  onChange: (v: AudienceFilter) => void;
}) {
  const options: { value: AudienceFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "shared", label: "Shared" },
    { value: "management_only", label: "Management only" },
  ];
  return (
    <div className="inline-flex rounded-md border border-gray-800 bg-gray-900 p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={
            value === opt.value
              ? "rounded-sm bg-blue-900/60 px-3 py-1 text-sm text-blue-100"
              : "rounded-sm px-3 py-1 text-sm text-gray-400 hover:text-gray-100"
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function SopRow({
  sop,
  isManagement,
  uploaderName,
  onEdit,
  onDelete,
}: {
  sop: Sop;
  isManagement: boolean;
  uploaderName: string;
  onEdit?: (s: Sop) => void;
  onDelete?: (s: Sop) => void;
}) {
  const filePill = sop.originalMimeType.includes("pdf") ? "PDF" : "DOCX";
  const updated = new Date(sop.updatedAt).toLocaleDateString();
  return (
    <li className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <Link href={`/sops/${sop.id}`} className="group min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-gray-100 group-hover:text-blue-300">
            {sop.title}
          </span>
          <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] font-medium uppercase text-gray-300">
            {filePill}
          </span>
          {isManagement && (
            <span
              className={
                sop.audience === "shared"
                  ? "rounded bg-emerald-900/60 px-1.5 py-0.5 text-[10px] uppercase text-emerald-200"
                  : "rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] uppercase text-amber-200"
              }
            >
              {audienceLabel(sop.audience)}
            </span>
          )}
        </div>
        {sop.description && (
          <p className="mt-0.5 truncate text-sm text-gray-400">{sop.description}</p>
        )}
        <p className="mt-1 text-xs text-gray-500">
          {uploaderName ? `${uploaderName} · ` : ""}
          Updated {updated}
        </p>
      </Link>
      {isManagement && (
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => onEdit?.(sop)}
            className="rounded-md px-2 py-1 text-sm text-gray-300 hover:bg-gray-800"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => onDelete?.(sop)}
            className="rounded-md px-2 py-1 text-sm text-red-300 hover:bg-red-900/40"
          >
            Delete
          </button>
        </div>
      )}
    </li>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `bun run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/sops-list.tsx
git commit -m "feat(sops): add role-driven SopsList component"
```

---

## Task 13: `/sops` route — list page

**Files:**
- Create: `src/app/sops/page.tsx`
- Create: `src/app/sops/sops-page-client.tsx` (small client wrapper for modal state)

The server component fetches data and resolves uploader names; the client wrapper holds modal/edit/delete UI state. The upload modal itself comes in Task 14 — this task ships an empty stub for the modal so the page renders.

- [ ] **Step 1: Create the page server component**

```tsx
// src/app/sops/page.tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile, getSops } from "@/lib/supabase/queries";
import { AppHeader } from "@/components/app-header";
import { SopsPageClient } from "./sops-page-client";

export default async function SopsPage() {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile) redirect("/login");

  const sops = await getSops(supabase);

  // Resolve uploader display names. RLS lets EPOs read management profiles
  // by id, so this works for both roles.
  const uploaderIds = Array.from(new Set(sops.map((s) => s.uploadedBy)));
  const uploaders =
    uploaderIds.length === 0
      ? []
      : ((
          await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", uploaderIds)
        ).data ?? []);
  const uploadersById: Record<string, string> = {};
  for (const u of uploaders as { id: string; full_name: string | null }[]) {
    uploadersById[u.id] = u.full_name ?? "";
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <AppHeader userName={profile.fullName} />
      <SopsPageClient
        sops={sops}
        isManagement={profile.role === "management"}
        uploadersById={uploadersById}
      />
    </div>
  );
}
```

- [ ] **Step 2: Create the client wrapper (stubs for modal/edit/delete)**

```tsx
// src/app/sops/sops-page-client.tsx
"use client";

import { useState } from "react";
import { SopsList } from "@/components/sops-list";
import type { Sop } from "@/types/sops";

interface Props {
  sops: Sop[];
  isManagement: boolean;
  uploadersById: Record<string, string>;
}

export function SopsPageClient({ sops, isManagement, uploadersById }: Props) {
  // Modal/edit/delete state — wired up by later tasks.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_pendingEdit, setPendingEdit] = useState<Sop | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_pendingDelete, setPendingDelete] = useState<Sop | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_uploadOpen, setUploadOpen] = useState(false);

  return (
    <>
      <SopsList
        sops={sops}
        isManagement={isManagement}
        uploadersById={uploadersById}
        onRequestUpload={() => setUploadOpen(true)}
        onRequestEdit={(sop) => setPendingEdit(sop)}
        onRequestDelete={(sop) => setPendingDelete(sop)}
      />
      {/* Upload/edit modal added in Task 14, delete confirm added in Task 16. */}
    </>
  );
}
```

- [ ] **Step 3: Type-check + dev smoke**

```bash
bun run lint
bun run dev
```

Visit `http://localhost:3000/SecApp/sops` (after login). Expected: header renders with SOPs tab active; empty list message renders ("No SOPs uploaded..." for management or "No SOPs available yet." for EPOs); Upload SOP button shows for management and is currently a no-op.

- [ ] **Step 4: Commit**

```bash
git add src/app/sops/page.tsx src/app/sops/sops-page-client.tsx
git commit -m "feat(sops): add /sops route with role-aware list page"
```

---

## Task 14: Upload/edit modal (`<SopUploadForm>`)

**Files:**
- Create: `src/components/sop-upload-form.tsx`
- Modify: `src/app/sops/sops-page-client.tsx` (wire into modal state)

- [ ] **Step 1: Create the form component**

```tsx
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
          Title
          <input
            name="title"
            required
            defaultValue={initial?.title ?? ""}
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
```

- [ ] **Step 2: Wire it into the page client**

Update `src/app/sops/sops-page-client.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SopsList } from "@/components/sops-list";
import { SopUploadForm } from "@/components/sop-upload-form";
import { uploadSop, updateSop } from "./actions";
import type { Sop } from "@/types/sops";

interface Props {
  sops: Sop[];
  isManagement: boolean;
  uploadersById: Record<string, string>;
}

export function SopsPageClient({ sops, isManagement, uploadersById }: Props) {
  const router = useRouter();
  const [pendingEdit, setPendingEdit] = useState<Sop | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <>
      <SopsList
        sops={sops}
        isManagement={isManagement}
        uploadersById={uploadersById}
        onRequestUpload={() => setUploadOpen(true)}
        onRequestEdit={(sop) => setPendingEdit(sop)}
        onRequestDelete={() => {
          // Wired in Task 16.
        }}
      />

      <SopUploadForm
        open={uploadOpen}
        mode="create"
        onCancel={() => setUploadOpen(false)}
        onSubmit={async (fd) => {
          const res = await uploadSop(fd);
          if (res.ok) router.refresh();
          return res;
        }}
      />

      <SopUploadForm
        open={pendingEdit !== null}
        mode="edit"
        initial={pendingEdit ?? undefined}
        onCancel={() => setPendingEdit(null)}
        onSubmit={async (fd) => {
          if (!pendingEdit) return { ok: false, error: "No SOP selected" };
          const res = await updateSop(pendingEdit.id, fd);
          if (res.ok) router.refresh();
          return res;
        }}
      />
    </>
  );
}
```

- [ ] **Step 3: Manual smoke check** (run by AJ)

Run: `bun run dev`. Sign in as a management user. Click Upload SOP, fill the form with a real PDF, submit. Expected: modal closes, the new SOP appears in the list. If LibreOffice is not available locally, DOCX upload will fail with the friendly error — that's expected; PDF should always work.

- [ ] **Step 4: Commit**

```bash
git add src/components/sop-upload-form.tsx src/app/sops/sops-page-client.tsx
git commit -m "feat(sops): add upload/edit modal wired into list page"
```

---

## Task 15: SOP viewer (`/sops/[id]`)

**Files:**
- Create: `src/app/sops/[id]/page.tsx`
- Create: `src/components/sop-viewer.tsx`
- Modify: `src/lib/sops/storage.ts` (append `createSignedUrl` server-side helper)

- [ ] **Step 1: Add a signed-URL helper to storage.ts**

Append to `src/lib/sops/storage.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export const SIGNED_URL_TTL_SECONDS = 5 * 60; // 5 minutes

export async function createSignedSopUrl(
  supabase: SupabaseClient,
  path: string
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(SOPS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) {
    console.error("createSignedSopUrl failed:", error?.message);
    return null;
  }
  return data.signedUrl;
}
```

- [ ] **Step 2: Create the viewer client component**

```tsx
// src/components/sop-viewer.tsx
"use client";

interface SopViewerProps {
  pdfUrl: string;
  downloadUrl: string;
  downloadFilename: string;
}

export function SopViewer({ pdfUrl, downloadUrl, downloadFilename }: SopViewerProps) {
  return (
    <div className="flex flex-col">
      <div className="aspect-[3/4] w-full sm:aspect-auto sm:h-[80vh]">
        <iframe
          src={pdfUrl}
          title="SOP document"
          className="h-full w-full rounded-lg border border-gray-800 bg-white"
        />
      </div>
      <div className="mt-3 flex justify-end">
        <a
          href={downloadUrl}
          download={downloadFilename}
          className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-blue-50 hover:bg-blue-600"
        >
          Download original
        </a>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create the viewer page**

```tsx
// src/app/sops/[id]/page.tsx
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile, getSopById } from "@/lib/supabase/queries";
import { createSignedSopUrl } from "@/lib/sops/storage";
import { audienceLabel } from "@/lib/sops/audit";
import { AppHeader } from "@/components/app-header";
import { SopViewer } from "@/components/sop-viewer";

export default async function SopViewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile) redirect("/login");

  const sop = await getSopById(supabase, id);
  if (!sop) notFound();

  const [pdfUrl, downloadUrl] = await Promise.all([
    createSignedSopUrl(supabase, sop.storagePathPdf),
    createSignedSopUrl(supabase, sop.storagePathOriginal),
  ]);
  if (!pdfUrl || !downloadUrl) notFound();

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <AppHeader userName={profile.fullName} />
      <div className="space-y-3 p-3">
        <header className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold text-gray-100">{sop.title}</h1>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            {profile.role === "management" && (
              <span
                className={
                  sop.audience === "shared"
                    ? "rounded bg-emerald-900/60 px-1.5 py-0.5 uppercase text-emerald-200"
                    : "rounded bg-amber-900/60 px-1.5 py-0.5 uppercase text-amber-200"
                }
              >
                {audienceLabel(sop.audience)}
              </span>
            )}
            <span>Updated {new Date(sop.updatedAt).toLocaleString()}</span>
          </div>
          {sop.description && (
            <p className="text-sm text-gray-300">{sop.description}</p>
          )}
        </header>
        <SopViewer
          pdfUrl={pdfUrl}
          downloadUrl={downloadUrl}
          downloadFilename={sop.originalFilename}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Type-check + dev smoke**

```bash
bun run lint
bun run dev
```

Click an SOP in the list. Expected: dedicated viewer page loads, PDF renders inline (browser's PDF viewer), Download button serves the original file.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sops/storage.ts src/components/sop-viewer.tsx src/app/sops/[id]/page.tsx
git commit -m "feat(sops): add /sops/[id] viewer with signed URLs"
```

---

## Task 16: Delete confirmation flow

**Files:**
- Modify: `src/app/sops/sops-page-client.tsx`

- [ ] **Step 1: Wire delete into the client**

Replace the `onRequestDelete` no-op in `src/app/sops/sops-page-client.tsx` with a real flow that opens `<ConfirmDialog>` and calls `deleteSop`:

```tsx
// At the top, add:
import { ConfirmDialog } from "@/components/confirm-dialog";
import { deleteSop } from "./actions";

// Inside the component, add state:
const [pendingDelete, setPendingDelete] = useState<Sop | null>(null);
const [deleteError, setDeleteError] = useState<string | null>(null);

// Replace onRequestDelete in <SopsList />:
onRequestDelete={(sop) => {
  setDeleteError(null);
  setPendingDelete(sop);
}}

// Add at the bottom of the returned JSX, alongside the modals:
<ConfirmDialog
  open={pendingDelete !== null}
  title="Delete SOP?"
  body={
    pendingDelete
      ? `"${pendingDelete.title}" will be removed from the list. The audit log retains a permanent record of the deletion and the file remains in storage.`
      : ""
  }
  confirmLabel="Delete"
  variant="destructive"
  onCancel={() => setPendingDelete(null)}
  onConfirm={async () => {
    if (!pendingDelete) return;
    const res = await deleteSop(pendingDelete.id);
    if (!res.ok) {
      setDeleteError(res.error);
      return;
    }
    setPendingDelete(null);
    router.refresh();
  }}
/>
{deleteError && (
  <p className="fixed bottom-3 left-1/2 z-50 -translate-x-1/2 rounded bg-red-900 px-3 py-2 text-sm text-red-100">
    {deleteError}
  </p>
)}
```

- [ ] **Step 2: Manual smoke check** (run by AJ)

Run `bun run dev`. As management, delete an existing SOP. Expected: confirm dialog appears, accepting it removes the row, the file remains in Supabase Storage, and an audit log row is written (verifiable in Task 19's UI).

- [ ] **Step 3: Commit**

```bash
git add src/app/sops/sops-page-client.tsx
git commit -m "feat(sops): wire delete flow with ConfirmDialog"
```

---

## Task 17: `<SopAuditFilters>` — filter bar component

**Files:**
- Create: `src/components/sop-audit-filters.tsx`

The filter bar reads/writes URL search params so filter state survives reloads and is server-fetched.

- [ ] **Step 1: Implement the filter bar**

```tsx
// src/components/sop-audit-filters.tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import type { SopAuditAction } from "@/types/sops";

const ALL_ACTIONS: { value: SopAuditAction; label: string }[] = [
  { value: "upload", label: "Upload" },
  { value: "replace_file", label: "Replace" },
  { value: "edit_metadata", label: "Edit metadata" },
  { value: "visibility_change", label: "Visibility change" },
  { value: "delete", label: "Delete" },
];

interface Props {
  managementProfiles: { id: string; full_name: string | null }[];
}

export function SopAuditFilters({ managementProfiles }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [titleQuery, setTitleQuery] = useState(params?.get("q") ?? "");
  const [actorId, setActorId] = useState(params?.get("actor") ?? "");
  const [startDate, setStartDate] = useState(params?.get("start") ?? "");
  const [endDate, setEndDate] = useState(params?.get("end") ?? "");
  const [actions, setActions] = useState<Set<SopAuditAction>>(
    new Set((params?.get("actions") ?? "").split(",").filter(Boolean) as SopAuditAction[])
  );

  function apply() {
    const next = new URLSearchParams();
    if (titleQuery) next.set("q", titleQuery);
    if (actorId) next.set("actor", actorId);
    if (startDate) next.set("start", startDate);
    if (endDate) next.set("end", endDate);
    if (actions.size > 0) next.set("actions", Array.from(actions).join(","));
    const sopId = params?.get("sop_id");
    if (sopId) next.set("sop_id", sopId);
    startTransition(() => {
      router.push(`/sops/audit?${next.toString()}`);
    });
  }

  function reset() {
    setTitleQuery("");
    setActorId("");
    setStartDate("");
    setEndDate("");
    setActions(new Set());
    startTransition(() => router.push("/sops/audit"));
  }

  function toggleAction(a: SopAuditAction) {
    const next = new Set(actions);
    if (next.has(a)) next.delete(a);
    else next.add(a);
    setActions(next);
  }

  return (
    <div className="space-y-3 rounded-lg border border-gray-800 bg-gray-900 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs text-gray-400">
          Title contains
          <input
            value={titleQuery}
            onChange={(e) => setTitleQuery(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-800 bg-gray-950 px-2 py-1 text-sm text-gray-100"
          />
        </label>
        <label className="text-xs text-gray-400">
          Actor
          <select
            value={actorId}
            onChange={(e) => setActorId(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-800 bg-gray-950 px-2 py-1 text-sm text-gray-100"
          >
            <option value="">Any</option>
            {managementProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name ?? p.id}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-400">
          From
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-800 bg-gray-950 px-2 py-1 text-sm text-gray-100"
          />
        </label>
        <label className="text-xs text-gray-400">
          To
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-800 bg-gray-950 px-2 py-1 text-sm text-gray-100"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {ALL_ACTIONS.map((a) => (
          <button
            key={a.value}
            type="button"
            onClick={() => toggleAction(a.value)}
            className={
              actions.has(a.value)
                ? "rounded-full bg-blue-900/60 px-3 py-1 text-xs text-blue-100"
                : "rounded-full border border-gray-800 px-3 py-1 text-xs text-gray-400 hover:text-gray-100"
            }
          >
            {a.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={apply}
          disabled={pending}
          className="rounded-md bg-blue-700 px-3 py-1.5 text-sm text-blue-50 hover:bg-blue-600"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={pending}
          className="rounded-md px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `bun run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/sop-audit-filters.tsx
git commit -m "feat(sops): add audit log filter bar component"
```

---

## Task 18: `<SopAuditTable>` — results table

**Files:**
- Create: `src/components/sop-audit-table.tsx`

The table receives entries plus a `signedUrlByPath` map (the page generates signed URLs for any storage paths referenced in the visible page). For pagination, the page renders Prev/Next links; the table is purely presentational.

- [ ] **Step 1: Implement the component**

```tsx
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
                  <span title={e.actorEmail}>{e.actorFullName || e.actorId}</span>
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
```

- [ ] **Step 2: Type-check**

Run: `bun run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/sop-audit-table.tsx
git commit -m "feat(sops): add audit log results table component"
```

---

## Task 19: `/sops/audit` page (management-only)

**Files:**
- Create: `src/app/sops/audit/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
// src/app/sops/audit/page.tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  getProfile,
  getSopAuditLog,
  listManagementProfiles,
  type AuditFilters,
} from "@/lib/supabase/queries";
import { createSignedSopUrl } from "@/lib/sops/storage";
import { AppHeader } from "@/components/app-header";
import { SopAuditFilters } from "@/components/sop-audit-filters";
import { SopAuditTable } from "@/components/sop-audit-table";
import type { SopAuditAction } from "@/types/sops";

const PAGE_SIZE = 50;

function parseAuditActions(actionsParam: string | undefined): SopAuditAction[] {
  if (!actionsParam) return [];
  const valid: SopAuditAction[] = [
    "upload",
    "replace_file",
    "edit_metadata",
    "visibility_change",
    "delete",
  ];
  return actionsParam
    .split(",")
    .filter((a): a is SopAuditAction =>
      (valid as string[]).includes(a)
    );
}

export default async function SopAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();
  const profile = await getProfile(supabase);
  if (!profile) redirect("/login");
  if (profile.role !== "management") redirect("/sops");

  const params = await searchParams;
  const get = (k: string) =>
    typeof params[k] === "string" ? (params[k] as string) : undefined;

  const page = Math.max(0, parseInt(get("page") ?? "0", 10) || 0);
  const filters: AuditFilters = {
    sopId: get("sop_id"),
    actorId: get("actor"),
    actions: parseAuditActions(get("actions")),
    titleQuery: get("q"),
    startDate: get("start"),
    endDate: get("end"),
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };

  const [{ entries, totalCount }, mgmtProfiles] = await Promise.all([
    getSopAuditLog(supabase, filters),
    listManagementProfiles(supabase),
  ]);

  // Pre-sign URLs for any file-bearing rows on this page.
  const paths = Array.from(
    new Set(
      entries
        .flatMap((e) => [e.newStoragePath, e.supersededStoragePath])
        .filter((p): p is string => p !== null)
    )
  );
  const signedEntries = await Promise.all(
    paths.map(async (p) => [p, await createSignedSopUrl(supabase, p)] as const)
  );
  const signedUrlByPath: Record<string, string | null> = {};
  for (const [p, url] of signedEntries) signedUrlByPath[p] = url;

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const baseQuery = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string" && k !== "page") baseQuery.set(k, v);
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <AppHeader userName={profile.fullName} />
      <div className="space-y-3 p-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-100">SOP Audit Log</h1>
          <Link
            href="/sops"
            className="rounded-md px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800"
          >
            ← Back to SOPs
          </Link>
        </div>
        <SopAuditFilters managementProfiles={mgmtProfiles} />
        <SopAuditTable entries={entries} signedUrlByPath={signedUrlByPath} />
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>
            Page {page + 1} of {totalPages} ({totalCount} entries)
          </span>
          <div className="flex gap-2">
            <PageLink baseQuery={baseQuery} page={page - 1} disabled={page === 0}>
              Previous
            </PageLink>
            <PageLink
              baseQuery={baseQuery}
              page={page + 1}
              disabled={page + 1 >= totalPages}
            >
              Next
            </PageLink>
          </div>
        </div>
      </div>
    </div>
  );
}

function PageLink({
  baseQuery,
  page,
  disabled,
  children,
}: {
  baseQuery: URLSearchParams;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return <span className="rounded-md px-3 py-1 text-gray-700">{children}</span>;
  }
  const q = new URLSearchParams(baseQuery);
  q.set("page", String(page));
  return (
    <Link
      href={`/sops/audit?${q.toString()}`}
      className="rounded-md px-3 py-1 text-blue-300 hover:bg-gray-800 hover:text-blue-200"
    >
      {children}
    </Link>
  );
}
```

- [ ] **Step 2: Type-check + dev smoke**

```bash
bun run lint
bun run dev
```

As management: visit `/SecApp/sops/audit`. Expected: page renders with filter bar and (after a few uploads/edits) a table of audit rows. As an EPO: visit `/SecApp/sops/audit`. Expected: redirected to `/sops`.

- [ ] **Step 3: Commit**

```bash
git add src/app/sops/audit/page.tsx
git commit -m "feat(sops): add management-only /sops/audit page"
```

---

## Task 20: Document the LibreOffice deploy prereq

**Files:**
- Modify: `CLIPPER.md`

- [ ] **Step 1: Read the current Clipper doc to find the right section**

Run: `grep -n "Apache" CLIPPER.md` — locate where to insert a "Runtime dependencies" section (just before or after the Apache details).

- [ ] **Step 2: Append the SOP feature prereq**

Add a new section to `CLIPPER.md` (before the Troubleshooting section):

```markdown
## SOP feature: LibreOffice runtime dependency

The SOPs feature converts uploaded DOCX files to PDF using LibreOffice
headless (`soffice`). This binary must be installed on Clipper before
the SOPs feature ships:

```bash
ssh clipper "sudo zypper install -y libreoffice"
ssh clipper "soffice --version"
```

Both commands should succeed. If `soffice` is not on PATH for the user
running the Next.js standalone server, set `PATH` explicitly in the
systemd unit or wrap the binary.

Without LibreOffice, DOCX uploads return a friendly error to the
manager; PDF uploads continue to work.
```

- [ ] **Step 3: Commit**

```bash
git add CLIPPER.md
git commit -m "docs(clipper): document LibreOffice runtime dep for SOPs feature"
```

---

## Task 21: End-to-end smoke (manual, run by AJ)

**Files:** none

This is a checklist to run before declaring the feature ready. Not a code task — no commit. The migrations need to be applied in Supabase before this works.

- [ ] **Step 1: Apply migrations**

In the Supabase SQL editor (production or staging), paste and run `supabase/migrations/012_sops.sql`, then `supabase/migrations/013_sop_audit_log.sql`. Verify both succeed without errors.

- [ ] **Step 2: Install LibreOffice on the deploy target**

If smoke-testing on Clipper:

```bash
ssh clipper "sudo zypper install -y libreoffice"
ssh clipper "soffice --version"
```

If smoke-testing locally on macOS, install LibreOffice from libreoffice.org or `brew install --cask libreoffice` and ensure `soffice` is on PATH.

- [ ] **Step 3: Walk the happy path as management**

Sign in as a management user. Visit `/SecApp/sops`.
1. Click Upload SOP → fill title, audience=shared, select a small PDF → submit. Expected: row appears in the list.
2. Click the row → viewer page renders the PDF inline; Download button serves the file.
3. Edit the row (change title only, no file) → save. Expected: title updates in the list.
4. Edit again, replace the file with a DOCX → save. Expected: "Converting…" briefly, then the new PDF renders in the viewer; old DOCX still exists in Supabase Storage (verify in the Supabase dashboard).
5. Delete the row → confirm. Expected: row gone, files still in storage.

- [ ] **Step 4: Verify EPO visibility**

Sign in as an EPO. Visit `/SecApp/sops`.
1. Confirm only `shared` SOPs are visible.
2. Confirm Upload, Edit, Delete, and Audit log buttons are absent.
3. Visit `/SecApp/sops/audit` directly in the URL bar. Expected: redirect to `/sops`.

- [ ] **Step 5: Verify the audit log**

As management, visit `/SecApp/sops/audit`. Expected: rows for every action from Step 3 appear (upload, edit_metadata, replace_file, delete) with correct summaries. Filter by action type → only matching rows show. Click an SOP title → page filters to that document's chronology.

- [ ] **Step 6: Verify immutability**

In the Supabase SQL editor, run:

```sql
update sop_audit_log set title_at_action = 'tampered' where id = (select id from sop_audit_log limit 1);
```

Expected: error `sop_audit_log is append-only; UPDATE blocked`.

```sql
delete from sop_audit_log where id = (select id from sop_audit_log limit 1);
```

Expected: error `sop_audit_log is append-only; DELETE blocked`.

- [ ] **Step 7: Note any issues**

If anything is off, file `bd` issues for follow-up rather than patching here. The plan is complete only if Steps 3–6 all pass.

---

## Self-review notes

This plan covers each section of the spec:
- Spec § Data Model → Task 1
- Spec § Storage path scheme → Task 4
- Spec § RLS → Task 1 (storage + table policies)
- Spec § Audit Log Subsystem (schema, immutability, RPCs) → Task 2
- Spec § UI top nav → Task 11
- Spec § /sops list → Tasks 12–13
- Spec § viewer → Task 15
- Spec § upload modal → Task 14
- Spec § edit modal → Task 14 (same component)
- Spec § delete → Task 16
- Spec § audit log entry point → Task 12 (Audit log link in list header)
- Spec § server actions (upload/update/delete/convert) → Tasks 5, 8, 9, 10
- Spec § audit UI → Tasks 17, 18, 19
- Spec § file layout → reflected by file paths in every task
- Spec § testing → Tasks 5, 6, 8, 9, 10 (unit/action) + Task 21 (end-to-end smoke)
- Spec § deploy prerequisites → Task 20
- Spec § mobile → handled inline in the relevant components (responsive Tailwind classes in Tasks 12, 14, 15)
