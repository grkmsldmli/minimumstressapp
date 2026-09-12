-- A listing can be hidden in one tap, but closing it for good is a request.
--
-- This keeps three different intentions separate:
--   * temporary hold       spaces.status = 'delisted', reversible by the host
--   * replace the listing  the old row is held while the host creates another
--   * permanent closure    a durable request, reviewed and archived by staff
--
-- A permanent closure never deletes booking or payment history. Hard delete is
-- reserved for staff cleanup of a listing that has no booking history and no
-- closure request. Every staff listing mutation and its audit row are written
-- by one database function, so either both commit or neither does.

create table if not exists listing_closure_requests (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces (id) on delete restrict,
  host_id uuid references profiles (id) on delete set null,
  reason text not null check (
    reason in ('no_longer_available', 'lease_ended', 'business_closed', 'space_changed', 'other')
  ),
  detail text,
  state text not null default 'open' check (state in ('open', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text,
  check (detail is null or char_length(detail) <= 1000),
  check (resolution_note is null or char_length(resolution_note) <= 2000),
  check (
    (state = 'open' and resolved_at is null and resolved_by is null)
    or (state <> 'open' and resolved_at is not null and resolved_by is not null)
  )
);

create unique index if not exists listing_closure_requests_one_open_idx
  on listing_closure_requests (space_id)
  where state = 'open';

create index if not exists listing_closure_requests_queue_idx
  on listing_closure_requests (state, requested_at);

alter table listing_closure_requests enable row level security;

-- Hosts may see only their own request. All writes go through the narrowly
-- scoped function below, so a browser cannot approve, reject or forge one.
revoke all on listing_closure_requests from public, anon, authenticated;
grant select on listing_closure_requests to authenticated;
grant select, insert, update, delete on listing_closure_requests to service_role;

drop policy if exists "listing closure: host reads own requests" on listing_closure_requests;
create policy "listing closure: host reads own requests"
  on listing_closure_requests for select
  using (host_id = (select auth.uid()));

-- A host can no longer bypass the permanent-closure review by deleting the row
-- directly. Media can still be managed independently through its own policies.
revoke delete on spaces from authenticated;
drop policy if exists "spaces: host deletes own rows" on spaces;

-- Distinguish the short storage-upload window from a real pending listing.
-- Existing rows are complete by definition; only rows inserted after this
-- migration start null and are finalized once every required write succeeds.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'spaces'
      and column_name = 'creation_completed_at'
  ) then
    alter table spaces add column creation_completed_at timestamptz;
    update spaces set creation_completed_at = created_at;
  end if;
end $$;

create or replace function mark_browser_listing_creation_incomplete()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null then new.creation_completed_at := null; end if;
  return new;
end;
$$;

revoke all on function mark_browser_listing_creation_incomplete()
  from public, anon, authenticated;

drop trigger if exists spaces_mark_browser_creation_incomplete on spaces;
create trigger spaces_mark_browser_creation_incomplete
  before insert on spaces
  for each row
  execute function mark_browser_listing_creation_incomplete();

create schema if not exists private;

create or replace function private.request_listing_closure(
  p_space_id uuid,
  p_reason text,
  p_detail text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  owner_id uuid;
  archived timestamptz;
  existing_id uuid;
  request_id uuid;
  clean_detail text := nullif(btrim(p_detail), '');
begin
  if caller is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  if p_reason is null or p_reason not in (
    'no_longer_available', 'lease_ended', 'business_closed', 'space_changed', 'other'
  ) then
    raise exception 'choose a valid closure reason' using errcode = 'check_violation';
  end if;

  if clean_detail is not null and char_length(clean_detail) > 1000 then
    raise exception 'closure detail is too long' using errcode = 'check_violation';
  end if;

  if p_reason = 'other' and coalesce(char_length(clean_detail), 0) < 3 then
    raise exception 'add a short explanation for the closure' using errcode = 'check_violation';
  end if;

  select host_id, archived_at
    into owner_id, archived
  from spaces
  where id = p_space_id
  for update;

  if not found then
    raise exception 'no such listing' using errcode = 'no_data_found';
  end if;

  if owner_id is distinct from caller then
    raise exception 'permission denied: that listing belongs to another host'
      using errcode = 'insufficient_privilege';
  end if;

  if archived is not null then
    raise exception 'this listing is already permanently closed'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  -- Hiding and recording the request are one transaction. Existing bookings
  -- remain untouched and continue through their normal lifecycle.
  update spaces
    set status = 'delisted', updated_at = now()
  where id = p_space_id;

  select id into existing_id
  from listing_closure_requests
  where space_id = p_space_id and state = 'open'
  for update;

  if existing_id is not null then
    update listing_closure_requests
      set reason = p_reason,
          detail = clean_detail,
          requested_at = now()
    where id = existing_id
    returning id into request_id;
  else
    insert into listing_closure_requests (space_id, host_id, reason, detail)
    values (p_space_id, caller, p_reason, clean_detail)
    returning id into request_id;
  end if;

  return request_id;
end;
$$;

revoke all on function private.request_listing_closure(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function private.request_listing_closure(uuid, text, text)
  to authenticated, service_role;

-- Client-facing facade stays SECURITY INVOKER. The privileged implementation
-- is in the private schema, following the same boundary as migration 0077.
create or replace function public.request_listing_closure(
  p_space_id uuid,
  p_reason text,
  p_detail text default null
)
returns uuid
language sql
volatile
security invoker
set search_path = pg_catalog
as $$
  select private.request_listing_closure(p_space_id, p_reason, p_detail)
$$;

revoke all on function public.request_listing_closure(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.request_listing_closure(uuid, text, text)
  to authenticated, service_role;

-- Internal rollback for the create-listing upload sequence. Storage requires a
-- space row to exist before its files can be accepted, so a failed upload has
-- one narrowly defined cleanup path. This is not an operational delete: only a
-- newly created, never-reviewed pending row with no bookings or closure history
-- qualifies, and there is no UI button for it.
create or replace function private.discard_incomplete_listing(p_space_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  listing spaces%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  select * into listing from spaces where id = p_space_id for update;
  if not found then return false; end if;

  if listing.host_id is distinct from auth.uid() then
    raise exception 'permission denied: that listing belongs to another host'
      using errcode = 'insufficient_privilege';
  end if;

  if listing.status <> 'pending'
     or listing.creation_completed_at is not null
     or listing.archived_at is not null
     or listing.sublease_doc_reviewed_at is not null
     or listing.created_at < now() - interval '30 minutes'
     or exists (select 1 from bookings where space_id = p_space_id)
     or exists (select 1 from listing_closure_requests where space_id = p_space_id) then
    raise exception 'only a newly created incomplete listing can be discarded'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  delete from spaces where id = p_space_id;
  return true;
end;
$$;

revoke all on function private.discard_incomplete_listing(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.discard_incomplete_listing(uuid)
  to authenticated, service_role;

create or replace function public.discard_incomplete_listing(p_space_id uuid)
returns boolean
language sql
volatile
security invoker
set search_path = pg_catalog
as $$
  select private.discard_incomplete_listing(p_space_id)
$$;

revoke all on function public.discard_incomplete_listing(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.discard_incomplete_listing(uuid)
  to authenticated, service_role;

create or replace function private.finalize_listing_creation(p_space_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  listing spaces%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  select * into listing from spaces where id = p_space_id for update;
  if not found then
    raise exception 'no such listing' using errcode = 'no_data_found';
  end if;
  if listing.host_id is distinct from auth.uid() then
    raise exception 'permission denied: that listing belongs to another host'
      using errcode = 'insufficient_privilege';
  end if;
  if listing.status <> 'pending'
     or listing.creation_completed_at is not null
     or listing.created_at < now() - interval '30 minutes' then
    raise exception 'this listing is not an in-progress creation'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  update spaces set creation_completed_at = now(), updated_at = now()
  where id = p_space_id;
  return true;
end;
$$;

revoke all on function private.finalize_listing_creation(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.finalize_listing_creation(uuid)
  to authenticated, service_role;

create or replace function public.finalize_listing_creation(p_space_id uuid)
returns boolean
language sql
volatile
security invoker
set search_path = pg_catalog
as $$
  select private.finalize_listing_creation(p_space_id)
$$;

revoke all on function public.finalize_listing_creation(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_listing_creation(uuid)
  to authenticated, service_role;

-- A host cannot reopen a listing while its permanent-closure request is on the
-- operator's desk. A rejection releases the listing back to the normal
-- delisted -> pending review path; an approval archives it, which 0078 already
-- prevents a host from reopening.
create or replace function block_reopen_with_open_closure_request()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null
     and old.status = 'delisted'
     and new.status = 'pending'
     and exists (
       select 1 from listing_closure_requests
       where space_id = old.id and state = 'open'
     ) then
    raise exception 'permission denied: permanent closure is waiting for review'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

revoke all on function block_reopen_with_open_closure_request() from public, anon, authenticated;

drop trigger if exists spaces_block_reopen_with_open_closure_request on spaces;
create trigger spaces_block_reopen_with_open_closure_request
  before update on spaces
  for each row
  when (old.status = 'delisted' and new.status = 'pending')
  execute function block_reopen_with_open_closure_request();

-- The only write path for Command Center listing operations. This function is
-- deliberately service-role-only; the Next route still authenticates and
-- allow-lists staff before calling it, then supplies the actor for the audit.
-- PostgreSQL functions run in one transaction, so a failed audit insert rolls
-- back the listing/request mutation, including a hard delete.
create or replace function admin_apply_listing_action(
  p_space_id uuid,
  p_action text,
  p_admin_user_id uuid,
  p_admin_email text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  listing spaces%rowtype;
  closure listing_closure_requests%rowtype;
  clean_reason text := nullif(btrim(p_reason), '');
  archived timestamptz;
  result jsonb;
begin
  if p_action not in (
    'approve', 'reject', 'send_to_review', 'hide', 'restore_live',
    'archive', 'delete', 'approve_closure', 'reject_closure'
  ) then
    raise exception 'unknown listing action' using errcode = 'check_violation';
  end if;

  if p_action in (
    'reject', 'send_to_review', 'hide', 'restore_live', 'archive', 'delete',
    'approve_closure', 'reject_closure'
  ) and coalesce(char_length(clean_reason), 0) < 3 then
    raise exception 'add a short reason so the intervention is auditable'
      using errcode = 'check_violation';
  end if;

  select * into listing from spaces where id = p_space_id for update;
  if not found then
    raise exception 'no such listing' using errcode = 'no_data_found';
  end if;

  if p_admin_user_id is null then
    raise exception 'the acting staff account is required' using errcode = 'not_null_violation';
  end if;

  if p_action not in ('approve_closure', 'reject_closure')
     and exists (
       select 1 from listing_closure_requests
       where space_id = p_space_id and state = 'open'
     ) then
    raise exception 'this listing has a permanent-closure request; approve or reject that request first'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  case p_action
    when 'approve' then
      if listing.status <> 'pending' then
        raise exception 'only a pending listing can be approved'
          using errcode = 'object_not_in_prerequisite_state';
      end if;
      if listing.creation_completed_at is null then
        raise exception 'listing creation is incomplete and cannot be approved'
          using errcode = 'object_not_in_prerequisite_state';
      end if;
      update spaces set
        status = 'active',
        archived_at = null,
        sublease_doc_state = 'verified',
        sublease_doc_reviewed_at = now(),
        doc_review_note = null,
        review_reason = null,
        previous_address_line = null
      where id = p_space_id;
      result := jsonb_build_object('toStatus', 'active');

    when 'reject' then
      if listing.status <> 'pending' then
        raise exception 'only a pending listing can be rejected'
          using errcode = 'object_not_in_prerequisite_state';
      end if;
      update spaces set
        status = 'delisted',
        archived_at = null,
        sublease_doc_state = 'rejected',
        sublease_doc_reviewed_at = now(),
        doc_review_note = clean_reason
      where id = p_space_id;
      result := jsonb_build_object('toStatus', 'delisted');

    when 'send_to_review' then
      update spaces set status = 'pending', archived_at = null where id = p_space_id;
      result := jsonb_build_object('toStatus', 'pending');

    when 'hide' then
      update spaces set status = 'delisted', archived_at = null where id = p_space_id;
      result := jsonb_build_object('toStatus', 'delisted');

    when 'restore_live' then
      if listing.sublease_doc_state <> 'verified' then
        raise exception 'the listing is not verified; send it to review instead'
          using errcode = 'object_not_in_prerequisite_state';
      end if;
      update spaces set status = 'active', archived_at = null where id = p_space_id;
      result := jsonb_build_object('toStatus', 'active');

    when 'archive' then
      archived := now();
      update spaces set status = 'delisted', archived_at = archived where id = p_space_id;
      result := jsonb_build_object('toStatus', 'delisted', 'archivedAt', archived);

    when 'delete' then
      if listing.status = 'active' then
        raise exception 'hide the live listing before deleting it'
          using errcode = 'object_not_in_prerequisite_state';
      end if;
      if listing.archived_at is not null then
        raise exception 'an archived listing is a durable record and cannot be deleted'
          using errcode = 'object_not_in_prerequisite_state';
      end if;
      if exists (select 1 from bookings where space_id = p_space_id) then
        raise exception 'this listing has booking history and cannot be deleted'
          using errcode = 'foreign_key_violation';
      end if;
      if exists (select 1 from listing_closure_requests where space_id = p_space_id) then
        raise exception 'this listing has closure history and cannot be deleted; archive it instead'
          using errcode = 'foreign_key_violation';
      end if;
      delete from spaces where id = p_space_id;
      result := jsonb_build_object('deleted', true);

    when 'approve_closure' then
      select * into closure
      from listing_closure_requests
      where space_id = p_space_id and state = 'open'
      for update;
      if not found then
        raise exception 'no open permanent-closure request'
          using errcode = 'object_not_in_prerequisite_state';
      end if;
      archived := now();
      update spaces set status = 'delisted', archived_at = archived where id = p_space_id;
      update listing_closure_requests set
        state = 'approved',
        resolved_at = now(),
        resolved_by = p_admin_user_id,
        resolution_note = clean_reason
      where id = closure.id;
      result := jsonb_build_object(
        'toStatus', 'delisted', 'archivedAt', archived, 'closureRequestId', closure.id
      );

    when 'reject_closure' then
      select * into closure
      from listing_closure_requests
      where space_id = p_space_id and state = 'open'
      for update;
      if not found then
        raise exception 'no open permanent-closure request'
          using errcode = 'object_not_in_prerequisite_state';
      end if;
      update listing_closure_requests set
        state = 'rejected',
        resolved_at = now(),
        resolved_by = p_admin_user_id,
        resolution_note = clean_reason
      where id = closure.id;
      -- Rejection does not silently republish the room. The host may choose to
      -- send the still-hidden listing back through review afterwards.
      result := jsonb_build_object('toStatus', listing.status, 'closureRequestId', closure.id);
  end case;

  insert into admin_audit_log (
    admin_user_id, admin_email, action, target_type, target_id, reason, metadata
  ) values (
    p_admin_user_id,
    p_admin_email,
    'listing_' || p_action,
    'listing',
    p_space_id::text,
    clean_reason,
    jsonb_build_object(
      'fromStatus', listing.status,
      'fromArchivedAt', listing.archived_at
    ) || coalesce(result, '{}'::jsonb)
  );

  return coalesce(result, '{}'::jsonb);
end;
$$;

revoke all on function admin_apply_listing_action(uuid, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function admin_apply_listing_action(uuid, text, uuid, text, text)
  to service_role;
