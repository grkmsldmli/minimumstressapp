-- Founding 100, and the Founding-Practitioner Pro benefit.
--
-- Two things, both purely additive on top of 0060 (host) and 0068 (practitioner),
-- which are applied to production and MUST NOT be edited:
--
--   1. Raise both founding cohorts from 50 to 100. This is done by `create or
--      replace`-ing the award + remaining functions and swapping the range/ceiling
--      constraints — never by touching 0060/0068. The 101st of either cohort still
--      can never be awarded.
--
--   2. The Founding-Practitioner Pro benefit (6 months free, then lifetime 50%)
--      needs NO schema here: exactly like the Founding-Host Studio Pro benefit, the
--      free months are a DERIVED entitlement (lib/entitlements) from
--      founding_practitioner_at — which 0068 already stores — and the 50% is a
--      Stripe coupon tied to the benefit. So this migration is only the cap change.
--
-- Idempotent throughout: every function is create-or-replace, every constraint is
-- drop-if-exists then add, and each re-backfill inserts only for accounts not
-- already in its ledger and only up to the new cap.

-- ==================================================================
-- Founding Host → 100
-- ==================================================================

-- profiles range check: 1..50 → 1..100.
alter table profiles drop constraint if exists profiles_founding_number_range;
alter table profiles
  add constraint profiles_founding_number_range check (
    founding_number is null or (founding_number between 1 and 100)
  );

-- The ledger's own primary-key range check (auto-named by 0060's column check).
alter table founding_hosts drop constraint if exists founding_hosts_founding_number_check;
alter table founding_hosts drop constraint if exists founding_hosts_founding_number_range;
alter table founding_hosts
  add constraint founding_hosts_founding_number_range check (founding_number between 1 and 100);

-- Allocation ceiling: 50 → 100. Body is otherwise identical to 0060's.
create or replace function award_founding_host(p_host_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  taken integer;
  next_num integer;
  existing_num integer;
  existing_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('founding_host_allocation'));

  select founding_number, earned_at into existing_num, existing_at
    from founding_hosts where host_id = p_host_id;
  if existing_num is not null then
    update profiles
      set founding_number = existing_num, founding_host_at = existing_at
      where id = p_host_id
        and (founding_number is distinct from existing_num
             or founding_host_at is distinct from existing_at);
    return;
  end if;

  select count(*) into taken from founding_hosts;
  if taken >= 100 then
    return;
  end if;

  select coalesce(max(founding_number), 0) + 1 into next_num from founding_hosts;

  insert into founding_hosts (founding_number, host_id) values (next_num, p_host_id);

  update profiles
    set founding_number = next_num,
        founding_host_at = (select earned_at from founding_hosts where host_id = p_host_id)
    where id = p_host_id;
end;
$$;

revoke all on function award_founding_host(uuid) from public;
grant execute on function award_founding_host(uuid) to service_role;

-- Remaining: 50 → 100.
create or replace function founding_hosts_remaining()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(0, 100 - (select count(*) from founding_hosts))::integer;
$$;

revoke all on function founding_hosts_remaining() from public;
grant execute on function founding_hosts_remaining() to anon, authenticated, service_role;

-- Re-backfill the newly-opened spots (51..100) for hosts already live who were
-- passed over when the cap was 50 — the same deterministic rule 0060 used, only
-- with the higher ceiling. Idempotent: a host already in the ledger is skipped,
-- and once the cohort is full nothing is inserted.
with qualified as (
  select s.host_id,
         min(coalesce(s.sublease_doc_reviewed_at, s.created_at)) as went_live
  from spaces s
  where s.status = 'active'
  group by s.host_id
),
candidates as (
  select q.host_id, q.went_live
  from qualified q
  where not exists (select 1 from founding_hosts fh where fh.host_id = q.host_id)
),
taken as (select count(*)::int as n from founding_hosts),
ranked as (
  select c.host_id, c.went_live,
         row_number() over (order by c.went_live asc, c.host_id asc) as rn
  from candidates c
)
insert into founding_hosts (founding_number, host_id, earned_at)
select (select n from taken) + r.rn, r.host_id, r.went_live
from ranked r
where (select n from taken) + r.rn <= 100;

update profiles p
set founding_number = fh.founding_number,
    founding_host_at = fh.earned_at
from founding_hosts fh
where fh.host_id = p.id
  and p.founding_number is null;

-- ==================================================================
-- Founding Practitioner → 100
-- ==================================================================

alter table profiles drop constraint if exists profiles_founding_practitioner_range;
alter table profiles
  add constraint profiles_founding_practitioner_range check (
    founding_practitioner_number is null or (founding_practitioner_number between 1 and 100)
  );

alter table founding_practitioners drop constraint if exists founding_practitioners_founding_number_check;
alter table founding_practitioners drop constraint if exists founding_practitioners_founding_number_range;
alter table founding_practitioners
  add constraint founding_practitioners_founding_number_range check (founding_number between 1 and 100);

create or replace function award_founding_practitioner(p_practitioner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  taken integer;
  next_num integer;
  existing_num integer;
  existing_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('founding_practitioner_allocation'));

  -- Let enforce_founding_server_only accept the projection writes below even when
  -- this award was triggered by a client-authored profile update (see 0068).
  perform set_config('app.founding_award', 'on', true);

  select founding_number, earned_at into existing_num, existing_at
    from founding_practitioners where practitioner_id = p_practitioner_id;
  if existing_num is not null then
    update profiles
      set founding_practitioner_number = existing_num, founding_practitioner_at = existing_at
      where id = p_practitioner_id
        and (founding_practitioner_number is distinct from existing_num
             or founding_practitioner_at is distinct from existing_at);
    return;
  end if;

  select count(*) into taken from founding_practitioners;
  if taken >= 100 then
    return;
  end if;

  select coalesce(max(founding_number), 0) + 1 into next_num from founding_practitioners;

  insert into founding_practitioners (founding_number, practitioner_id)
    values (next_num, p_practitioner_id);

  update profiles
    set founding_practitioner_number = next_num,
        founding_practitioner_at =
          (select earned_at from founding_practitioners where practitioner_id = p_practitioner_id)
    where id = p_practitioner_id;
end;
$$;

revoke all on function award_founding_practitioner(uuid) from public;
grant execute on function award_founding_practitioner(uuid) to service_role;

create or replace function founding_practitioners_remaining()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(0, 100 - (select count(*) from founding_practitioners))::integer;
$$;

revoke all on function founding_practitioners_remaining() from public;
grant execute on function founding_practitioners_remaining() to anon, authenticated, service_role;

-- Re-backfill 51..100 for practitioners already fully verified when the cap was
-- 50 — the same deterministic rule 0068 used, ordered by when the last of the
-- three verdicts landed. Idempotent.
with qualified as (
  select p.id as practitioner_id,
         greatest(
           p.identity_verified_at,
           p.insurance_doc_reviewed_at,
           p.credential_doc_reviewed_at
         ) as qualified_at
  from profiles p
  where profile_founding_practitioner_qualified(p)
),
candidates as (
  select q.practitioner_id, q.qualified_at
  from qualified q
  where not exists (
    select 1 from founding_practitioners fp where fp.practitioner_id = q.practitioner_id
  )
),
taken as (select count(*)::int as n from founding_practitioners),
ranked as (
  select c.practitioner_id, c.qualified_at,
         row_number() over (order by c.qualified_at asc nulls last, c.practitioner_id asc) as rn
  from candidates c
)
insert into founding_practitioners (founding_number, practitioner_id, earned_at)
select (select n from taken) + r.rn, r.practitioner_id, coalesce(r.qualified_at, now())
from ranked r
where (select n from taken) + r.rn <= 100;

update profiles p
set founding_practitioner_number = fp.founding_number,
    founding_practitioner_at = fp.earned_at
from founding_practitioners fp
where fp.practitioner_id = p.id
  and p.founding_practitioner_number is null;
