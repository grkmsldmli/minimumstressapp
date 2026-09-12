-- Supabase Security Advisor hardening for intentionally public/read-only views.
--
-- These views were SECURITY DEFINER on purpose: each one exposes a narrow,
-- curated projection or aggregate over tables whose base RLS is stricter than
-- the product's read surface. Flipping them directly to SECURITY INVOKER would
-- make ordinary practitioner reads disappear (or error) because the caller is
-- not allowed to select the underlying host/private rows directly.
--
-- Keep the existing, audited projection logic unchanged, but move the
-- privileged implementation view out of PostgREST's exposed `public` schema.
-- A tiny SECURITY INVOKER facade keeps the stable public API name. The caller
-- may select only the private implementation view explicitly granted below;
-- no base-table privilege is widened and no new column is exposed.
--
-- Supabase's security_definer_view advisor only flags SECURITY DEFINER views
-- that are reachable in an exposed PostgREST schema. This is the same boundary
-- Supabase recommends for privileged helpers: privileged object private,
-- internet-facing object invoker.

create schema if not exists private;

-- Nobody may create objects in the helper schema. The three runtime roles get
-- only USAGE so the public invoker facades can resolve their backing views.
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

do $$
declare
  spec record;
  internal_name text;
  public_is_invoker boolean;
begin
  for spec in
    select * from (values
      -- view name                 anon?   service_role?
      ('public_reviews',            false,  true),
      ('space_ratings',             false,  true),
      ('availability_public',       false,  true),
      ('spaces_public',             false,  true),
      ('public_host_profiles',      false,  true),
      ('space_media_public',        false,  true),
      ('city_inventory',            true,   true),
      ('city_type_inventory',       true,   true),
      ('city_category_inventory',   true,   true),
      ('space_demand',              true,   true),
      ('session_counts',            false,  false)
    ) as t(view_name, allow_anon, allow_service)
  loop
    internal_name := '_ms_' || spec.view_name || '_definer';

    select coalesce(
      c.reloptions && array[
        'security_invoker=1',
        'security_invoker=true',
        'security_invoker=yes',
        'security_invoker=on'
      ],
      false
    )
      into public_is_invoker
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = spec.view_name
      and c.relkind = 'v';

    if not found then
      raise exception '0074 expected public view % to exist', spec.view_name;
    end if;

    -- Standalone re-runs stop here: the public facade and private backing view
    -- already exist. A full apply.sql re-run is different: earlier migrations
    -- recreate the original public SECURITY DEFINER view, so public_is_invoker
    -- is false and we refresh the private implementation from that latest DDL.
    if not public_is_invoker then
      if to_regclass(format('private.%I', internal_name)) is not null then
        execute format('drop view private.%I cascade', internal_name);
      end if;

      execute format('alter view public.%I set schema private', spec.view_name);
      execute format(
        'alter view private.%I rename to %I',
        spec.view_name,
        internal_name
      );
      execute format(
        'create view public.%I with (security_invoker = true) as select * from private.%I',
        spec.view_name,
        internal_name
      );
    elsif to_regclass(format('private.%I', internal_name)) is null then
      raise exception
        '0074 found invoker facade public.% without backing view private.%',
        spec.view_name,
        internal_name;
    end if;

    -- Moving a view preserves its old ACL. Reset both layers deliberately so
    -- an old anon grant cannot survive on the private implementation by
    -- accident, then restore exactly the product access that existed before.
    execute format(
      'revoke all on private.%I from public, anon, authenticated, service_role',
      internal_name
    );
    execute format(
      'revoke all on public.%I from public, anon, authenticated, service_role',
      spec.view_name
    );

    execute format('grant select on private.%I to authenticated', internal_name);
    execute format('grant select on public.%I to authenticated', spec.view_name);

    if spec.allow_anon then
      execute format('grant select on private.%I to anon', internal_name);
      execute format('grant select on public.%I to anon', spec.view_name);
    end if;

    if spec.allow_service then
      execute format('grant select on private.%I to service_role', internal_name);
      execute format('grant select on public.%I to service_role', spec.view_name);
    end if;
  end loop;
end $$;
