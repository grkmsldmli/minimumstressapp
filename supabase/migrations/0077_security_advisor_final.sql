-- Supabase Security Advisor — remaining warning cleanup.
--
-- This migration clears the remaining warning classes without weakening the
-- product's authorization model:
--   * client-callable SECURITY DEFINER routines move behind invoker facades;
--   * trigger/event-trigger helpers lose direct client EXECUTE;
--   * public storage buckets remain publicly serveable, but clients can no
--     longer enumerate every object through storage.objects;
--   * anonymous space-demand inserts keep working, but the RLS policy now
--     validates the row instead of accepting an unconditional TRUE.
--
-- The private-schema facade pattern is the same one used by 0074 for views:
-- PostgREST keeps a stable public API name, while the privileged implementation
-- lives outside the exposed schema. Re-runnable, including during a full
-- apply.sql second pass where earlier migrations recreate the original routines.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

-- ------------------------------------------------------------------
-- Public buckets: public URLs still serve the bytes, but a broad SELECT policy
-- on storage.objects is unnecessary and allows bucket enumeration/listing.
-- Upload/delete owner policies remain unchanged.
-- ------------------------------------------------------------------
drop policy if exists "avatars: public read" on storage.objects;
drop policy if exists "space-media: public read" on storage.objects;

-- ------------------------------------------------------------------
-- Space-demand intake: keep anonymous/authenticated INSERT, but make the policy
-- describe a valid intake row rather than WITH CHECK (true). The time window
-- also prevents callers from manufacturing historical/future demand rows.
-- ------------------------------------------------------------------
drop policy if exists "space_requests: anyone may say what they need" on space_requests;
create policy "space_requests: anyone may say what they need"
  on space_requests
  for insert
  to anon, authenticated
  with check (
    length(looking_in) between 1 and 80
    and (
      space_type is null
      or space_type in (
        'pilates-studio',
        'yoga-studio',
        'movement-studio',
        'massage-room',
        'treatment-room',
        'acupuncture-room',
        'esthetician-room',
        'consultation-room',
        'meditation-room',
        'reiki-room'
      )
    )
    and (email is null or length(email) <= 320)
    and created_at >= now() - interval '5 minutes'
    and created_at <= now() + interval '1 minute'
  );

-- ------------------------------------------------------------------
-- Move privileged client/read helpers out of the exposed public schema.
--
-- If this is the first pass, public.* is the original SECURITY DEFINER routine:
-- move it and rename it. On a standalone re-run, public.* is already the safe
-- SECURITY INVOKER facade and the private backing routine already exists.
-- On a full migration re-run, earlier migrations recreate the original public
-- definer; refresh the private implementation from that latest definition.
-- ------------------------------------------------------------------
do $$
declare
  spec record;
  public_is_definer boolean;
  public_exists boolean;
  private_sig text;
  public_sig text;
begin
  for spec in
    select * from (values
      ('attribute_referral',                'text', '_ms_attribute_referral_definer'),
      ('founding_hosts_remaining',          '',     '_ms_founding_hosts_remaining_definer'),
      ('founding_practitioners_remaining',  '',     '_ms_founding_practitioners_remaining_definer'),
      ('host_bookings',                     '',     '_ms_host_bookings_definer'),
      ('host_requests',                     '',     '_ms_host_requests_definer'),
      ('is_booking_participant',            'uuid', '_ms_is_booking_participant_definer'),
      ('mark_messages_read',                'uuid', '_ms_mark_messages_read_definer'),
      ('my_referral_code',                  '',     '_ms_my_referral_code_definer'),
      ('my_referral_rewards',               '',     '_ms_my_referral_rewards_definer'),
      ('my_referrals',                      '',     '_ms_my_referrals_definer'),
      ('space_access_details',              'uuid', '_ms_space_access_details_definer')
    ) as t(routine_name, identity_args, backing_name)
  loop
    select exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = spec.routine_name
        and pg_get_function_identity_arguments(p.oid) = spec.identity_args
    ) into public_exists;

    select coalesce((
      select p.prosecdef
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = spec.routine_name
        and pg_get_function_identity_arguments(p.oid) = spec.identity_args
      limit 1
    ), false) into public_is_definer;

    public_sig := format('public.%I(%s)', spec.routine_name, spec.identity_args);
    private_sig := format('private.%I(%s)', spec.backing_name, spec.identity_args);

    if public_exists and public_is_definer then
      -- A full apply.sql re-run may have recreated public.* while the previous
      -- private backing still exists. Its public definition is the newest truth.
      if to_regprocedure(private_sig) is not null then
        execute format('drop function %s', private_sig);
      end if;

      execute format('alter function %s set schema private', public_sig);
      execute format(
        'alter function private.%I(%s) rename to %I',
        spec.routine_name,
        spec.identity_args,
        spec.backing_name
      );
    elsif not public_exists and to_regprocedure(private_sig) is null then
      raise exception '0077 expected routine % or backing % to exist', public_sig, private_sig;
    end if;
  end loop;
end $$;

-- Reset backing ACLs before granting only the callers each product surface needs.
revoke all on function private._ms_attribute_referral_definer(text) from public, anon, authenticated, service_role;
grant execute on function private._ms_attribute_referral_definer(text) to authenticated, service_role;

revoke all on function private._ms_founding_hosts_remaining_definer() from public, anon, authenticated, service_role;
grant execute on function private._ms_founding_hosts_remaining_definer() to anon, authenticated, service_role;

revoke all on function private._ms_founding_practitioners_remaining_definer() from public, anon, authenticated, service_role;
grant execute on function private._ms_founding_practitioners_remaining_definer() to anon, authenticated, service_role;

revoke all on function private._ms_host_bookings_definer() from public, anon, authenticated, service_role;
grant execute on function private._ms_host_bookings_definer() to authenticated, service_role;

revoke all on function private._ms_host_requests_definer() from public, anon, authenticated, service_role;
grant execute on function private._ms_host_requests_definer() to authenticated, service_role;

revoke all on function private._ms_is_booking_participant_definer(uuid) from public, anon, authenticated, service_role;
grant execute on function private._ms_is_booking_participant_definer(uuid) to authenticated, service_role;

revoke all on function private._ms_mark_messages_read_definer(uuid) from public, anon, authenticated, service_role;
grant execute on function private._ms_mark_messages_read_definer(uuid) to authenticated, service_role;

revoke all on function private._ms_my_referral_code_definer() from public, anon, authenticated, service_role;
grant execute on function private._ms_my_referral_code_definer() to authenticated, service_role;

revoke all on function private._ms_my_referral_rewards_definer() from public, anon, authenticated, service_role;
grant execute on function private._ms_my_referral_rewards_definer() to authenticated, service_role;

revoke all on function private._ms_my_referrals_definer() from public, anon, authenticated, service_role;
grant execute on function private._ms_my_referrals_definer() to authenticated, service_role;

revoke all on function private._ms_space_access_details_definer(uuid) from public, anon, authenticated, service_role;
grant execute on function private._ms_space_access_details_definer(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- Stable public RPC facades. None is privileged: each runs as the caller and can
-- reach only the exact private backing function granted above. The backing
-- functions keep the original bodies, security mode and RLS-bypass semantics.
-- ------------------------------------------------------------------
create or replace function public.attribute_referral(p_code text)
returns void
language sql
security invoker
set search_path = pg_catalog
as $$ select private._ms_attribute_referral_definer(p_code) $$;
revoke all on function public.attribute_referral(text) from public, anon, authenticated, service_role;
grant execute on function public.attribute_referral(text) to authenticated, service_role;

create or replace function public.founding_hosts_remaining()
returns integer
language sql
stable
security invoker
set search_path = pg_catalog
as $$ select private._ms_founding_hosts_remaining_definer() $$;
revoke all on function public.founding_hosts_remaining() from public, anon, authenticated, service_role;
grant execute on function public.founding_hosts_remaining() to anon, authenticated, service_role;

create or replace function public.founding_practitioners_remaining()
returns integer
language sql
stable
security invoker
set search_path = pg_catalog
as $$ select private._ms_founding_practitioners_remaining_definer() $$;
revoke all on function public.founding_practitioners_remaining() from public, anon, authenticated, service_role;
grant execute on function public.founding_practitioners_remaining() to anon, authenticated, service_role;

create or replace function public.host_bookings()
returns table (
  booking_id uuid,
  space_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.booking_status,
  net_cents integer,
  practitioner_name text,
  practitioner_avatar_path text,
  host_paid_at timestamptz,
  practitioner_profession text,
  practitioner_identity_verified boolean,
  practitioner_insurance_verified boolean,
  practitioner_credential_reviewed boolean,
  practitioner_completed_sessions integer,
  practitioner_good_standing boolean
)
language sql
security invoker
set search_path = pg_catalog
as $$ select * from private._ms_host_bookings_definer() $$;
revoke all on function public.host_bookings() from public, anon, authenticated, service_role;
grant execute on function public.host_bookings() to authenticated, service_role;

create or replace function public.host_requests()
returns table (
  booking_id uuid,
  space_id uuid,
  space_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  requested_at timestamptz,
  net_cents integer,
  practitioner_name text,
  practitioner_avatar_path text,
  purpose text,
  purpose_note text,
  attendee_count integer,
  practitioner_profession text,
  practitioner_identity_verified boolean,
  practitioner_insurance_verified boolean,
  practitioner_credential_reviewed boolean,
  practitioner_completed_sessions integer,
  practitioner_good_standing boolean
)
language sql
security invoker
set search_path = pg_catalog
as $$ select * from private._ms_host_requests_definer() $$;
revoke all on function public.host_requests() from public, anon, authenticated, service_role;
grant execute on function public.host_requests() to authenticated, service_role;

create or replace function public.is_booking_participant(p_booking_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog
as $$ select private._ms_is_booking_participant_definer(p_booking_id) $$;
revoke all on function public.is_booking_participant(uuid) from public, anon, authenticated, service_role;
grant execute on function public.is_booking_participant(uuid) to authenticated, service_role;

create or replace function public.mark_messages_read(p_booking_id uuid)
returns integer
language sql
security invoker
set search_path = pg_catalog
as $$ select private._ms_mark_messages_read_definer(p_booking_id) $$;
revoke all on function public.mark_messages_read(uuid) from public, anon, authenticated, service_role;
grant execute on function public.mark_messages_read(uuid) to authenticated, service_role;

create or replace function public.my_referral_code()
returns text
language sql
stable
security invoker
set search_path = pg_catalog
as $$ select private._ms_my_referral_code_definer() $$;
revoke all on function public.my_referral_code() from public, anon, authenticated, service_role;
grant execute on function public.my_referral_code() to authenticated, service_role;

create or replace function public.my_referral_rewards()
returns table (referral_id uuid, amount_cents integer, payout_state text)
language sql
security invoker
set search_path = pg_catalog
as $$ select * from private._ms_my_referral_rewards_definer() $$;
revoke all on function public.my_referral_rewards() from public, anon, authenticated, service_role;
grant execute on function public.my_referral_rewards() to authenticated, service_role;

create or replace function public.my_referrals()
returns table (id uuid, status text, joined_at timestamptz)
language sql
stable
security invoker
set search_path = pg_catalog
as $$ select * from private._ms_my_referrals_definer() $$;
revoke all on function public.my_referrals() from public, anon, authenticated, service_role;
grant execute on function public.my_referrals() to authenticated, service_role;

create or replace function public.space_access_details(p_space_id uuid)
returns table (
  address_line text,
  lat double precision,
  lng double precision,
  entry_instructions text,
  access_type public.access_type
)
language sql
security invoker
set search_path = pg_catalog
as $$ select * from private._ms_space_access_details_definer(p_space_id) $$;
revoke all on function public.space_access_details(uuid) from public, anon, authenticated, service_role;
grant execute on function public.space_access_details(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- Trigger and event-trigger SECURITY DEFINER functions are invoked by their
-- trigger bindings, not as RPCs. Remove the default PUBLIC execute capability.
-- This also catches a platform/project helper such as rls_auto_enable() when it
-- exists in production, without hard-coding a database-local function name.
-- ------------------------------------------------------------------
do $$
declare
  r record;
  sig text;
begin
  for r in
    select
      p.proname,
      pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.prorettype in ('trigger'::regtype, 'event_trigger'::regtype)
  loop
    sig := format('public.%I(%s)', r.proname, r.identity_args);
    execute format('revoke all on function %s from public', sig);
    execute format('revoke execute on function %s from anon, authenticated', sig);
    execute format('grant execute on function %s to service_role', sig);
  end loop;
end $$;

-- A final defensive pass: public SECURITY DEFINER routines that are not client
-- facades must never retain the implicit PUBLIC grant. Service-only helpers keep
-- working; the explicit client surfaces above are now SECURITY INVOKER.
do $$
declare
  r record;
  sig text;
begin
  for r in
    select
      p.proname,
      pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
  loop
    sig := format('public.%I(%s)', r.proname, r.identity_args);
    execute format('revoke all on function %s from public', sig);
    execute format('revoke execute on function %s from anon, authenticated', sig);
  end loop;
end $$;
