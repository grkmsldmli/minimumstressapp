-- pg_net owns a dedicated `net` API schema, but its extension metadata must
-- live outside the exposed `public` schema. The first scheduler migration used
-- Postgres's public default; repair that cleanly before the first job exists.

do $$
declare
  installed_schema text;
begin
  select n.nspname
  into installed_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_net';

  if installed_schema = 'public' then
    if exists (select 1 from cron.job where command ilike '%net.http_%') then
      raise exception 'Refusing to relocate pg_net while scheduled HTTP jobs exist';
    end if;
    if exists (select 1 from net.http_request_queue) then
      raise exception 'Refusing to relocate pg_net while HTTP requests are queued';
    end if;

    drop extension pg_net;
    -- RESTRICT is deliberate: an unrelated object makes the migration roll
    -- back instead of being destroyed along with the extension's empty shell.
    drop schema if exists net restrict;
    create extension pg_net with schema extensions;
  elsif installed_schema is null
    and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension pg_net with schema extensions;
  end if;

  if exists (select 1 from pg_extension where extname = 'pg_net') then
    comment on extension pg_net is
      'Async HTTP used by the Vault-backed Minimum Stress recovery scheduler';
  end if;
end;
$$;
