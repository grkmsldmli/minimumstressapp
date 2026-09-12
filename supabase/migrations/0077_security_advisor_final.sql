-- Supabase Security Advisor — remaining warning cleanup.
--
-- One migration for the remaining warning classes:
--   * no unconditional public intake RLS policy;
--   * no broad object-listing policy on public media buckets;
--   * no client-facing SECURITY DEFINER routine in the exposed public schema.
--
-- Client RPC names stay stable. Privileged implementations move to the private
-- schema and small SECURITY INVOKER public facades call them with only the
-- execute grants each surface already had. Trigger/service helpers stay in
-- public but lose direct client EXECUTE. Re-runnable, including after a full
-- migration replay.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

-- Public bucket bytes remain governed by the bucket's public/private setting;
-- these broad SELECT policies only make storage.objects enumerable.
drop policy if exists "avatars: public read" on storage.objects;
drop policy if exists "space-media: public read" on storage.objects;

-- Anonymous demand intake is still allowed, but the row must be a real shape
-- the product accepts instead of satisfying an unconditional WITH CHECK (true).
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

-- Client-facing privileged readers/actions. type_args contains only the input
-- types so to_regprocedure() resolves the routine regardless of SQL argument
-- names (p_code, p_booking_id, ...).
do $$
declare
  spec record;
  public_sig text;
  private_sig text;
  public_oid oid;
  private_oid oid;
  backing_oid oid;
  public_is_definer boolean;
  arg_defs text;
  result_def text;
  call_args text;
  volatility text;
  returns_set boolean;
  create_sql text;
begin
  for spec in
    select * from (values
      -- public name                       input types  private backing                         anon?
      ('attribute_referral',               'text',      '_ms_attribute_referral_definer',       false),
      ('founding_hosts_remaining',         '',          '_ms_founding_hosts_remaining_definer', true),
      ('founding_practitioners_remaining', '',          '_ms_founding_practitioners_remaining_definer', true),
      ('host_bookings',                    '',          '_ms_host_bookings_definer',            false),
      ('host_requests',                    '',          '_ms_host_requests_definer',            false),
      ('is_booking_participant',           'uuid',      '_ms_is_booking_participant_definer',   false),
      ('mark_messages_read',               'uuid',      '_ms_mark_messages_read_definer',       false),
      ('my_referral_code',                 '',          '_ms_my_referral_code_definer',         false),
      ('my_referral_rewards',              '',          '_ms_my_referral_rewards_definer',      false),
      ('my_referrals',                     '',          '_ms_my_referrals_definer',             false),
      ('space_access_details',             'uuid',      '_ms_space_access_details_definer',     false)
    ) as t(routine_name, type_args, backing_name, allow_anon)
  loop
    public_sig := format('public.%I(%s)', spec.routine_name, spec.type_args);
    private_sig := format('private.%I(%s)', spec.backing_name, spec.type_args);
    public_oid := to_regprocedure(public_sig);
    private_oid := to_regprocedure(private_sig);

    public_is_definer := false;
    if public_oid is not null then
      select p.prosecdef into public_is_definer
      from pg_proc p where p.oid = public_oid;
    end if;

    -- First run, or a full replay where an earlier migration recreated the
    -- original public definer: refresh the private implementation from it.
    if public_oid is not null and public_is_definer then
      if private_oid is not null then
        execute format('drop function %s', private_sig);
      end if;

      execute format('alter function %s set schema private', public_sig);
      execute format(
        'alter function private.%I(%s) rename to %I',
        spec.routine_name,
        spec.type_args,
        spec.backing_name
      );
      backing_oid := to_regprocedure(private_sig);
    else
      backing_oid := private_oid;
    end if;

    if backing_oid is null then
      raise exception '0077 expected % or % to exist', public_sig, private_sig;
    end if;

    -- Rebuild/refresh the unprivileged public facade from the backing routine's
    -- own catalog metadata so TABLE return shapes and argument names never drift.
    select
      pg_get_function_identity_arguments(p.oid),
      pg_get_function_result(p.oid),
      p.proretset,
      case p.provolatile
        when 'i' then 'immutable'
        when 's' then 'stable'
        else 'volatile'
      end,
      case
        when p.pronargs = 0 then ''
        else (
          select string_agg(format('$%s', i), ', ' order by i)
          from generate_series(1, p.pronargs) as g(i)
        )
      end
    into arg_defs, result_def, returns_set, volatility, call_args
    from pg_proc p
    where p.oid = backing_oid;

    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      private_sig
    );
    if spec.allow_anon then
      execute format('grant execute on function %s to anon', private_sig);
    end if;
    execute format('grant execute on function %s to authenticated, service_role', private_sig);

    create_sql := format(
      'create or replace function public.%I(%s) returns %s language sql %s security invoker set search_path = pg_catalog as %L',
      spec.routine_name,
      arg_defs,
      result_def,
      volatility,
      case
        when returns_set or result_def like 'TABLE(%' then
          format('select * from private.%I(%s)', spec.backing_name, call_args)
        else
          format('select private.%I(%s)', spec.backing_name, call_args)
      end
    );
    execute create_sql;

    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      public_sig
    );
    if spec.allow_anon then
      execute format('grant execute on function %s to anon', public_sig);
    end if;
    execute format('grant execute on function %s to authenticated, service_role', public_sig);
  end loop;
end $$;

-- Everything still SECURITY DEFINER in public after the facade pass is an
-- internal trigger/service helper, not a browser RPC. Remove default PUBLIC and
-- explicit browser grants. Trigger execution itself does not require callers to
-- hold EXECUTE on the trigger function. This also catches production-local
-- helpers such as rls_auto_enable() when present.
do $$
declare
  r record;
  sig text;
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as identity_args
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
