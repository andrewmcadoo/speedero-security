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
