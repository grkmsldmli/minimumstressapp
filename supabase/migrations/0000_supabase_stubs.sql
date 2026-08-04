-- Local-only stubs for the pieces Supabase provides.
--
-- NOT part of the real migration set — `supabase/schema.test.ts` runs this
-- first so the migrations can be executed against a bare Postgres, and the
-- test suite skips it when listing migrations to apply in production.
--
-- Everything here is either created by Supabase itself (auth.users,
-- storage.buckets, storage.objects) or is a helper its API layer injects
-- (auth.uid, storage.foldername). The definitions mirror the real shapes
-- closely enough to typecheck the DDL and exercise the policy expressions.

-- The roles Supabase's API gateway assumes per request: `anon` for an
-- unauthenticated caller, `authenticated` once a JWT is present. Every grant
-- in the migrations targets one of these, so they have to exist first.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

create schema if not exists auth;
create schema if not exists storage;

-- Supabase grants these itself. Without them auth.uid() raises "permission
-- denied for schema auth" the moment a policy evaluates it, which would make
-- every policy look like it was denying access for the right reason.
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key,
  email text unique
);

-- Supabase resolves this from the request JWT. Locally it reads a GUC so a
-- test can impersonate a user with set_config('request.jwt.claim.sub', ...).
create or replace function auth.uid() returns uuid as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$ language sql stable;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  created_at timestamptz default now()
);

alter table storage.objects enable row level security;

-- Splits an object path into its folder segments, dropping the trailing
-- filename, so "space/{id}/doc.pdf" yields {space, id}. Mirrors Supabase's own
-- plpgsql implementation: a intermediate variable is needed because Postgres
-- cannot subscript a function call's result directly.
create or replace function storage.foldername(name text) returns text[] as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$ language plpgsql immutable;
