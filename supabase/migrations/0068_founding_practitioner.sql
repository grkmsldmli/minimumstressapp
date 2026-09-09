-- Founding Practitioner — the practitioner-side mirror of Founding Host (0060).
--
-- FOUNDING PRACTITIONER is a permanent legacy status for the first 50 unique
-- practitioners to complete a real, paid session — booking status 'completed'
-- with the card captured, and not a host booking their own room. One person is
-- one spot however many sessions they run, it is earned at the qualifying
-- session, and it is never taken away. Like Founding Host it carries no price or
-- benefit; it is recognition only.
--
-- The trigger point is the exact analog of the host's "first listing goes live":
-- the booking sweep's upcoming -> completed transition (api/cron), at which
-- point captured_at is already set (0030). The qualifying row can never later be
-- un-completed or deleted — keep_held_session_permanent (0060) already
-- guarantees that — so the earned status is durable with no extra machinery.
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
-- The one qualifying moment, allocated in the same transaction.
--
-- Earned when a booking moves upcoming -> completed (the sweep), provided the
-- card was captured and it is not a host booking their own room — the same
-- "real, money-moved session between two people" that session_counts (0016)
-- defines. Definer-run so the allocation does not depend on the caller's role.
-- If all fifty are gone the award returns without a number and the update
-- commits normally. The captured_at and self-booking guards live here because a
-- trigger WHEN clause cannot join spaces.
-- ------------------------------------------------------------------
create or replace function allocate_founding_practitioner_on_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host_id uuid;
begin
  if new.captured_at is null then
    return null;
  end if;
  select host_id into v_host_id from spaces where id = new.space_id;
  if v_host_id is null or v_host_id = new.practitioner_id then
    return null;
  end if;
  perform award_founding_practitioner(new.practitioner_id);
  return null;
end;
$$;

drop trigger if exists bookings_allocate_founding_practitioner on bookings;
create trigger bookings_allocate_founding_practitioner
  after update on bookings
  for each row
  when (old.status = 'upcoming' and new.status = 'completed')
  execute function allocate_founding_practitioner_on_session();

-- ------------------------------------------------------------------
-- One-time backfill for practitioners already qualifying when this ships.
--
-- The trigger only fires on future completions, so without this every
-- practitioner who has already run a real session would be passed over. This
-- grants them their place, deterministic and derived entirely from real rows.
--
-- Qualification is a completed, captured booking that is not self-booked.
-- Practitioners are ordered by the moment of their earliest qualifying session
-- (starts_at — the session's own time), tie-broken by id. One person takes one
-- spot however many sessions they have run, numbers run 1..50 and stop, and a
-- practitioner who somehow already holds a valid assignment is left untouched.
-- Idempotent: run again and every qualifier is already numbered, the rest find
-- no spots under fifty, and nothing changes.
-- ------------------------------------------------------------------
with qualified as (
  select b.practitioner_id,
         min(b.starts_at) as first_session
  from bookings b
  join spaces s on s.id = b.space_id
  where b.status = 'completed'
    and b.captured_at is not null
    and b.practitioner_id <> s.host_id
  group by b.practitioner_id
),
candidates as (
  select q.practitioner_id, q.first_session
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
         c.first_session,
         row_number() over (order by c.first_session asc, c.practitioner_id asc) as rn
  from candidates c
)
insert into founding_practitioners (founding_number, practitioner_id, earned_at)
select (select n from taken) + r.rn, r.practitioner_id, r.first_session
from ranked r
where (select n from taken) + r.rn <= 50;

update profiles p
set founding_practitioner_number = fp.founding_number,
    founding_practitioner_at = fp.earned_at
from founding_practitioners fp
where fp.practitioner_id = p.id
  and p.founding_practitioner_number is null;
