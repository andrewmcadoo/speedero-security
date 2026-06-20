-- 014_user_deletion_preserve_attribution.sql
-- Allow hard-deleting users while preserving attribution on the rows
-- they authored. Four operational tables move to ON DELETE SET NULL.
-- sop_audit_log uses snapshot columns instead because its append-only
-- triggers (013) reject the UPDATE that SET NULL would perform.
--
-- Without this migration, admin.auth.admin.deleteUser() fails with a
-- foreign-key violation whenever the user touched assignments,
-- date_settings, travel_legs, sops, or sop_audit_log.

-- ---- assignments.assigned_by ----
alter table assignments alter column assigned_by drop not null;
alter table assignments drop constraint assignments_assigned_by_fkey;
alter table assignments
  add constraint assignments_assigned_by_fkey
  foreign key (assigned_by) references profiles(id) on delete set null;

-- ---- date_settings.updated_by ----
alter table date_settings alter column updated_by drop not null;
alter table date_settings drop constraint date_settings_updated_by_fkey;
alter table date_settings
  add constraint date_settings_updated_by_fkey
  foreign key (updated_by) references profiles(id) on delete set null;

-- ---- travel_legs.created_by ----
alter table travel_legs alter column created_by drop not null;
alter table travel_legs drop constraint travel_legs_created_by_fkey;
alter table travel_legs
  add constraint travel_legs_created_by_fkey
  foreign key (created_by) references profiles(id) on delete set null;

-- ---- sops.uploaded_by ----
alter table sops alter column uploaded_by drop not null;
alter table sops drop constraint sops_uploaded_by_fkey;
alter table sops
  add constraint sops_uploaded_by_fkey
  foreign key (uploaded_by) references profiles(id) on delete set null;

-- ---- sop_audit_log: snapshot actor identity, drop the FK ----
-- Audit-log immutability triggers in 013 reject any UPDATE, including the
-- one that ON DELETE SET NULL would issue. Instead, snapshot the actor's
-- email and full name at insert time, then drop the FK so deleting the
-- referenced profile no longer touches this table at all.
--
-- actor_id stays as a non-FK uuid so filtering by actor still works.

alter table sop_audit_log add column actor_email_at_action text;
alter table sop_audit_log add column actor_full_name_at_action text;

-- Backfill existing rows. session_replication_role = replica bypasses
-- the immutability triggers for this transaction only.
set local session_replication_role = replica;
update sop_audit_log a
   set actor_email_at_action = p.email,
       actor_full_name_at_action = coalesce(p.full_name, '')
  from profiles p
 where p.id = a.actor_id;
set local session_replication_role = origin;

alter table sop_audit_log
  alter column actor_email_at_action set not null,
  alter column actor_full_name_at_action set not null;

alter table sop_audit_log drop constraint sop_audit_log_actor_id_fkey;

-- ---------------------------------------------------------------------
-- Re-create the three audit RPCs from 013_sop_audit_log.sql so every
-- insert into sop_audit_log also writes the snapshot columns. Each
-- function now looks up the actor identity from profiles after the
-- auth check and uses the snapshot in every audit insert.
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
declare
  v_actor_email text;
  v_actor_full_name text;
begin
  if not is_management() then
    raise exception 'unauthorized';
  end if;

  select email, coalesce(full_name, '')
    into v_actor_email, v_actor_full_name
    from profiles where id = p_actor_id;

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
    new_storage_path, new_filename, new_mime_type, new_file_size_bytes,
    actor_email_at_action, actor_full_name_at_action
  ) values (
    p_actor_id, p_sop_id, 'upload',
    p_title, p_audience,
    p_storage_path_pdf, p_original_filename, p_original_mime_type, p_file_size_bytes,
    v_actor_email, v_actor_full_name
  );
end;
$$;

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
  v_actor_email text;
  v_actor_full_name text;
begin
  if not is_management() then
    raise exception 'unauthorized';
  end if;

  select email, coalesce(full_name, '')
    into v_actor_email, v_actor_full_name
    from profiles where id = p_actor_id;

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
      prev_title, prev_description, next_description,
      actor_email_at_action, actor_full_name_at_action
    ) values (
      p_actor_id, p_sop_id, 'edit_metadata', p_new_title, p_new_audience,
      v_current.title, v_current.description, p_new_description,
      v_actor_email, v_actor_full_name
    );
  end if;

  if v_audience_changed then
    insert into sop_audit_log (
      actor_id, sop_id, action, title_at_action, audience_at_action,
      prev_audience,
      actor_email_at_action, actor_full_name_at_action
    ) values (
      p_actor_id, p_sop_id, 'visibility_change', p_new_title, p_new_audience,
      v_current.audience,
      v_actor_email, v_actor_full_name
    );
  end if;

  if v_file_changed then
    insert into sop_audit_log (
      actor_id, sop_id, action, title_at_action, audience_at_action,
      new_storage_path, new_filename, new_mime_type, new_file_size_bytes,
      superseded_storage_path, superseded_filename,
      actor_email_at_action, actor_full_name_at_action
    ) values (
      p_actor_id, p_sop_id, 'replace_file', p_new_title, p_new_audience,
      p_new_storage_path_pdf, p_new_original_filename, p_new_original_mime_type, p_new_file_size_bytes,
      v_current.storage_path_pdf, v_current.original_filename,
      v_actor_email, v_actor_full_name
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
  v_actor_email text;
  v_actor_full_name text;
begin
  if not is_management() then
    raise exception 'unauthorized';
  end if;

  select email, coalesce(full_name, '')
    into v_actor_email, v_actor_full_name
    from profiles where id = p_actor_id;

  select * into v_current from sops where id = p_sop_id for update;
  if not found then
    raise exception 'sop not found';
  end if;

  insert into sop_audit_log (
    actor_id, sop_id, action, title_at_action, audience_at_action,
    superseded_storage_path, superseded_filename,
    actor_email_at_action, actor_full_name_at_action
  ) values (
    p_actor_id, p_sop_id, 'delete', v_current.title, v_current.audience,
    v_current.storage_path_pdf, v_current.original_filename,
    v_actor_email, v_actor_full_name
  );

  delete from sops where id = p_sop_id;
end;
$$;
