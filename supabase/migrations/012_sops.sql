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
