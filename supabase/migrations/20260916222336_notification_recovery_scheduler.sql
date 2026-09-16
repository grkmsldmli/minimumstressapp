-- Free, minute-precision recovery for durable notification and marketing
-- outboxes. The job itself is provisioned after the matching application route
-- is deployed because its bearer belongs in Vault, never in git or migration
-- history.

do $$
begin
  -- Managed Supabase exposes both extensions. The availability check also
  -- keeps the repository's PGlite migration runner faithful without teaching
  -- that local WASM database how to make network calls or run background jobs.
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    execute 'create extension if not exists pg_net with schema extensions';
    comment on extension pg_net is
      'Async HTTP used by the Vault-backed Minimum Stress recovery scheduler';
  end if;

  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    comment on extension pg_cron is
      'Runs the Minimum Stress recovery endpoint every five minutes';
  end if;
end;
$$;
