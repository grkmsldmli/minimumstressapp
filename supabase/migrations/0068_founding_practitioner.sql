-- Founding Practitioner — the practitioner-side mirror of Founding Host (0060).
--
-- FOUNDING PRACTITIONER is a permanent legacy status for the first 50 unique
-- practitioners who complete professional onboarding — a genuine, vetted early
-- professional, not the first to run a transaction. One person is one spot, it
-- is earned the moment onboarding is complete, and it is never taken away. Like
-- Founding Host it carries no price or benefit; it is recognition only.
--
-- "Onboarding complete" is defined entirely from server-truth on the profile:
-- a practitioner account, a completed professional profile (a name and a chosen
-- profession), plus the three verification VERDICTS that are all server-written
-- and client-unwritable (identity 0057, insurance 0054, credential 0058, guarded
-- by enforce_profile_verdicts_server_only). It mirrors the app's own "ready to
-- book" gate in lib/booking-plan: verified identity + verified insurance +
-- verified credential. It deliberately keys on the permanent staff VERDICT
-- ('verified'), never the insurance date-window, so the status can never flip
-- false when cover later lapses. There is no "available for work" requirement —
-- that product does not exist yet.
--
-- Authority is the founding_practitioners ledger below, not the profile: a
-- profile can be scrubbed, so counting live profile rows would let a departed
-- practitioner's spot re-open. The ledger never loses a row.
-- profiles.founding_practitioner_number/_at are a projection for the read paths,
-- written in the same transaction.

alter table profiles
  add column if not exists founding_practitioner_at timestamptz,
  add column if not exists founding_practitioner_number integer;

-- The hard cap in the schema: a unique number 1..50, present exactly when the
-- timestamp is.
alter table profiles
  drop constraint if exists profiles_founding_practitioner_range;
alter table profiles
  add constraint profiles_founding_practitioner_range check (
    founding_practitioner_number is null or (founding_practitioner_number between 1 and 50)
  );
alter table profiles
  drop constraint if exists profiles_founding_practitioner_consistent;
alter table profiles
  add constraint profiles_founding_practitioner_consistent check (
    (founding_practitioner_at is null) = (founding_practitioner_number is null)
  );
drop index if exists profiles_founding_practitioner_number_key;
create unique index profiles_founding_practitioner_number_key
  on profiles (founding_practitioner_number)
  where founding_practitioner_number is not null;

-- ------------------------------------------------------------------
-- Founding status stays the server's to grant, never the account's.
--
-- Replaces the 0060 guard so the same rule now covers all four founding columns:
-- a signed-in caller can never write founding_host_at/number OR
-- founding_practitioner_at/number, on insert or update. Only the allocation
-- functions (service role, no auth.uid()) set them. The existing
-- profiles_founding_server_only trigger keeps calling this function.
-- ------------------------------------------------------------------
create or replace function enforce_founding_server_only()
returns trigger
language plpgsql
as $$
declare
  ins boolean := tg_op = 'INSERT';
begin
  -- The award functions flip this transaction-local flag before they project a
  -- founding number onto the profile. That nested write can run under a client's
  -- own auth.uid() — when a practitioner completes their profile as the last
  -- onboarding step and thereby triggers their own award — so without this
  -- carve-out the server's write would be refused as if the client had made it.
  -- The flag is only ever set inside the SECURITY DEFINER award functions, which
  -- no client can call, so it cannot be forged from the outside.
  if current_setting('app.founding_award', true) = 'on' then
    return new;
  end if;

  if auth.uid() is not null
     and (
       new.founding_host_at is distinct from (case when ins then null else old.founding_host_at end)
       or new.founding_number is distinct from (case when ins then null else old.founding_number end)
       or new.founding_practitioner_at is distinct from (case when ins then null else old.founding_practitioner_at end)
       or new.founding_practitioner_number is distinct from (case when ins then null else old.founding_practitioner_number end)
     ) then
    raise exception 'founding status is set by the server, not the client'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------------
-- The durable record of the fifty practitioners — the allocation authority.
--
-- Server-only, no foreign key (it must outlive the profile it names), one row
-- per practitioner. RLS on with no policy and grants revoked, so only the
-- definer functions below ever touch it.
-- ------------------------------------------------------------------
create table if not exists founding_practitioners (
  founding_number integer primary key check (founding_number between 1 and 50),
  practitioner_id uuid not null unique,
  earned_at timestamptz not null default now()
);

alter table founding_practitioners enable row level security;
revoke all on founding_practitioners from anon, authenticated;

-- ------------------------------------------------------------------
-- Allocate a Founding Practitioner spot, atomically.
--
-- Same shape as award_founding_host: a transaction-scoped advisory lock
-- serialises every award so two practitioners finishing at the same instant can
-- never both take the last spot; the ledger's primary key, unique
-- practitioner_id and 1..50 check are the backstop. Idempotent: a practitioner
-- already in the ledger keeps their original number and moment, and the profile
-- projection is refreshed in case it was lost. Never re-numbers, never re-opens.
-- ------------------------------------------------------------------
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
  -- this award was triggered by a client-authored profile update (see that guard).
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
  if taken >= 50 then
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

-- How many Founding Practitioner spots are left, from the durable ledger.
-- SECURITY DEFINER so every caller gets the same real, global count.
create or replace function founding_practitioners_remaining()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(0, 50 - (select count(*) from founding_practitioners))::integer;
$$;

revoke all on function founding_practitioners_remaining() from public;
grant execute on function founding_practitioners_remaining() to anon, authenticated, service_role;

-- ------------------------------------------------------------------
-- Who qualifies — one predicate, shared by the trigger and the backfill.
--
-- Takes a whole profiles row and returns whether that practitioner has
-- completed professional onboarding. IMMUTABLE (only scalar comparisons on its
-- argument, no table reads), so it is legal inside a trigger WHEN clause.
--
-- Credential and insurance are required for every practitioner here, mirroring
-- the app's live booking gate (lib/booking-plan: requiresCredential is true for
-- every profession today, and insurance is checked for every booking). If the
-- product later makes either optional for some professions, this predicate — and
-- founding-sql-sync's expectations — must move with professions.ts.
-- ------------------------------------------------------------------
create or replace function profile_founding_practitioner_qualified(p profiles)
returns boolean
language sql
immutable
as $$
  select
    p.account_type = 'practitioner'
    and p.display_name is not null
    and length(btrim(p.display_name)) > 0
    and p.profession is not null
    and p.identity_verified_at is not null
    and p.insurance_doc_state = 'verified'
    and p.credential_doc_state = 'verified';
$$;

-- ------------------------------------------------------------------
-- The qualifying moment, allocated in the same transaction.
--
-- Earned on the profile UPDATE that first makes the predicate true — whether
-- that update is a server verdict (identity webhook, staff insurance/credential
-- review) or the practitioner completing their name/profession as the last step.
-- Definer-run so allocation does not depend on the caller's role. The award's
-- own nested projection update leaves the row already-qualified, so the WHEN is
-- false on it and there is no recursion. No AFTER INSERT trigger is needed: a
-- fresh profile can never be born qualified (the verdicts all start null/pending
-- and are set only by later, separate server writes).
-- ------------------------------------------------------------------
create or replace function allocate_founding_practitioner_on_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform award_founding_practitioner(new.id);
  return null;
end;
$$;

-- Remove the earlier paid-session trigger/function (this migration is not yet
-- applied anywhere, but the drops keep a re-run against any partially-applied
-- database clean).
drop trigger if exists bookings_allocate_founding_practitioner on bookings;
drop function if exists allocate_founding_practitioner_on_session();

drop trigger if exists profiles_allocate_founding_practitioner on profiles;
create trigger profiles_allocate_founding_practitioner
  after update on profiles
  for each row
  when (
    profile_founding_practitioner_qualified(new)
    and not profile_founding_practitioner_qualified(old)
  )
  execute function allocate_founding_practitioner_on_profile();

-- ------------------------------------------------------------------
-- One-time backfill for practitioners already onboarded when this ships.
--
-- The trigger only fires on future profile updates, so without this every
-- practitioner already fully verified would be passed over. This grants them
-- their place, deterministic and derived entirely from server-truth columns.
--
-- Ordered by when the LAST requirement landed — greatest() of the three verdict
-- timestamps (identity, insurance, credential), all guaranteed present when the
-- state is 'verified' by the 0054/0058 constraints — tie-broken by id. One
-- person takes one spot, numbers run 1..50 and stop, and a practitioner who
-- somehow already holds a valid assignment is left untouched. Idempotent: run
-- again and every qualifier is already numbered, the rest find no spots under
-- fifty, and nothing changes.
-- ------------------------------------------------------------------
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
taken as (
  select count(*)::int as n from founding_practitioners
),
ranked as (
  select c.practitioner_id,
         c.qualified_at,
         row_number() over (order by c.qualified_at asc nulls last, c.practitioner_id asc) as rn
  from candidates c
)
insert into founding_practitioners (founding_number, practitioner_id, earned_at)
select (select n from taken) + r.rn, r.practitioner_id, coalesce(r.qualified_at, now())
from ranked r
where (select n from taken) + r.rn <= 50;

update profiles p
set founding_practitioner_number = fp.founding_number,
    founding_practitioner_at = fp.earned_at
from founding_practitioners fp
where fp.practitioner_id = p.id
  and p.founding_practitioner_number is null;
