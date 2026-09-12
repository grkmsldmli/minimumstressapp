-- Supabase Security Advisor: Function Search Path Mutable
--
-- Every user-owned routine in the exposed public schema should execute with a
-- deterministic search_path. Leaving it mutable allows an invoker to influence
-- name resolution inside routines that use unqualified objects.
--
-- Keep the path deliberately small:
--   public      — app tables, types and helper routines
--   extensions  — Supabase-installed extension functions (PostGIS, etc.)
--   pg_temp     — last, so temporary objects cannot shadow trusted names
--
-- pg_catalog is searched implicitly by PostgreSQL. Extension-owned routines are
-- skipped; they are managed by their extension. Routines that already declare
-- search_path are left untouched.
--
-- Re-runnable/idempotent.

do $$
declare
  r record;
  ddl text;
begin
  for r in
    select
      p.oid,
      p.proname,
      p.prokind,
      pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) as cfg
        where cfg like 'search_path=%'
      )
      and not exists (
        select 1
        from pg_depend d
        join pg_extension e on e.oid = d.refobjid
        where d.classid = 'pg_proc'::regclass
          and d.objid = p.oid
          and d.refclassid = 'pg_extension'::regclass
          and d.deptype = 'e'
      )
  loop
    ddl := format(
      'alter %s public.%I(%s) set search_path = public, extensions, pg_temp',
      case when r.prokind = 'p' then 'procedure' else 'function' end,
      r.proname,
      r.identity_args
    );
    execute ddl;
  end loop;
end $$;
