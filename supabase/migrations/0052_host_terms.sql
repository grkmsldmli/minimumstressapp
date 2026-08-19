-- The Host Terms, accepted separately from the general terms.
--
-- 0020 recorded who accepted the general Terms of Service, versioned. Listing
-- a space is a second undertaking, with obligations a guest never takes on —
-- the right to offer the room, the accuracy of the listing, responsibility for
-- access and for the property. This is the record of accepting *that*, kept on
-- its own columns and its own version so a host's agreement to the hosting
-- terms is a separate, dated, provable event rather than something folded into
-- the terms everyone accepts to use the app.
--
-- It mirrors 0020 deliberately: the same write-once, never-backdated, cannot-be-
-- withdrawn shape, so there is one proven pattern for "who agreed to what, and
-- when" rather than two that drift.
--
-- Two things differ, and both are in the prompt for this work:
--
--   The version is the database's to decide, not the caller's. 0020 lets the
--   client send the version it is accepting; here the trigger clamps whatever
--   arrives to `required_host_terms_version()`. A forged write can only ever
--   record the current required version — the server is the source of truth
--   for what was accepted, which a listing gate depends on.
--
--   Listing is gated on it. The spaces insert policy already required a host
--   account; it now also requires the host to have accepted the current Host
--   Terms. Enforced in RLS rather than the client, so a direct insert cannot
--   skip it either.
--
-- Backward compatible. The gate is on INSERT only, so every existing listing
-- keeps working untouched; an existing host accepts the Host Terms before
-- their next new listing, not before their old ones keep running.

-- ------------------------------------------------------------------
-- The required version, in one place the database owns.
--
-- Bumped by a future migration when the Host Terms change materially and hosts
-- must re-accept. The app constant HOST_TERMS_VERSION must equal this; a schema
-- test asserts it, because the two are the same fact read from two sides — the
-- client checks it to decide whether to ask again, the trigger stamps from it.
-- ------------------------------------------------------------------
create or replace function required_host_terms_version()
returns integer
language sql
immutable
as $$ select 1 $$;

-- ------------------------------------------------------------------
-- The acceptance record: one version and one moment, per account.
-- ------------------------------------------------------------------
alter table profiles
  add column if not exists host_terms_accepted_at timestamptz,
  add column if not exists host_terms_version integer;

-- Both or neither. A version with no moment is a claim with nothing behind it.
alter table profiles
  drop constraint if exists profiles_host_terms_consistent;
alter table profiles
  add constraint profiles_host_terms_consistent check (
    (host_terms_accepted_at is null) = (host_terms_version is null)
  );

-- ------------------------------------------------------------------
-- Write-once, never backdated, never withdrawn — and stamped by the server.
--
-- Not gated on auth.uid(): the general-terms trigger in 0020 is, because that
-- acceptance is written by the client. This one is written by the server (an
-- admin-client route stamps it, so the caller cannot record a version they
-- were not shown), and a service-role write has no auth.uid(). Gating on it
-- would silently skip the stamping and let the raw value through.
-- ------------------------------------------------------------------
create or replace function enforce_host_terms_acceptance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  was integer := case when tg_op = 'UPDATE' then old.host_terms_version else null end;
begin
  -- Only act when the version is being set or changed. An unrelated profile
  -- update leaves it alone, and re-sending the same value is harmless.
  if new.host_terms_version is distinct from was
     or (tg_op = 'UPDATE' and new.host_terms_accepted_at is distinct from old.host_terms_accepted_at) then

    if new.host_terms_version is null then
      if was is null then
        return new;
      end if;
      raise exception 'Accepted Host Terms cannot be withdrawn.'
        using errcode = 'check_violation';
    end if;

    if was is not null and new.host_terms_version < was then
      raise exception 'Host Terms version cannot go backwards.'
        using errcode = 'check_violation';
    end if;

    -- The version is the database's to decide, and the clock is the server's.
    -- Whatever the caller sent, what is recorded is the current required
    -- version, accepted now.
    new.host_terms_version := required_host_terms_version();
    new.host_terms_accepted_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_host_terms_acceptance on profiles;

create trigger profiles_host_terms_acceptance
  before insert or update on profiles
  for each row
  execute function enforce_host_terms_acceptance();

-- ------------------------------------------------------------------
-- Listing requires accepting the Host Terms.
--
-- 0012 replaced the plain insert policy with one that also requires a host
-- account, and explained why a second permissive policy would have ORed the
-- requirements into nothing. Same reasoning here: this REPLACES 0012's policy
-- rather than joining it, so a listing needs a host account AND accepted Host
-- Terms, not either.
-- ------------------------------------------------------------------
drop policy if exists "spaces: host inserts own rows" on spaces;
drop policy if exists "spaces: only hosts may list" on spaces;

create policy "spaces: only hosts may list"
  on spaces for insert
  with check (
    host_id = auth.uid()
    and exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.account_type = 'host'
        -- Accepted, and at the current required version. A host who accepted
        -- an older version is asked again before this passes.
        and p.host_terms_version is not null
        and p.host_terms_version >= required_host_terms_version()
    )
  );

-- ------------------------------------------------------------------
-- Existing hosts and listings.
--
-- Nothing is backfilled and nothing is removed. host_terms_version is null on
-- every current account — recording an acceptance that never happened is the
-- one thing this record exists not to do. Existing listings keep running
-- because the gate is on INSERT; an existing host accepts before their next
-- new listing.
-- ------------------------------------------------------------------
