-- Founding 50, host achievements, and the host signals a practitioner may see.
--
-- FOUNDING HOST is a permanent legacy status for the first 50 unique hosts to
-- bring a listing live. One host is one spot however many rooms they list, it is
-- earned the moment their first listing is approved, and it is never taken away
-- — deleting a listing later does not touch it. It carries no price or benefit;
-- it is recognition only.
--
-- The allocation authority is the founding_hosts ledger below, not the profile:
-- a profile can be scrubbed and, for a host with no bookings, cascade-deleted, so
-- counting live profile rows would let a departed host's spot re-open and be
-- handed to somebody else. The ledger never loses a row, so a spot once consumed
-- is one of the fifty forever. profiles.founding_number/founding_host_at are a
-- projection of the ledger for the read paths, written in the same transaction:
--
--   founding_host_at   when the status was earned (server-written, permanent).
--   founding_number    1..50, the order earned — a UNIQUE, capped column so the
--                      database itself cannot hold a 51st Founding Host.
--
-- Host achievements are read live from completed, captured bookings; a guard at
-- the foot of this file makes that count monotonic so a milestone cannot un-earn.

alter table profiles
  add column if not exists founding_host_at timestamptz,
  add column if not exists founding_number integer;

-- The hard cap lives in the schema, not only in the function: a unique number
-- between 1 and 50, present exactly when the timestamp is.
alter table profiles
  drop constraint if exists profiles_founding_number_range;
alter table profiles
  add constraint profiles_founding_number_range check (
    founding_number is null or (founding_number between 1 and 50)
  );
alter table profiles
  drop constraint if exists profiles_founding_consistent;
alter table profiles
  add constraint profiles_founding_consistent check (
    (founding_host_at is null) = (founding_number is null)
  );
drop index if exists profiles_founding_number_key;
create unique index profiles_founding_number_key
  on profiles (founding_number)
  where founding_number is not null;

-- ------------------------------------------------------------------
-- Founding status is the server's to grant, never the account's.
--
-- Same principle as the verification verdicts (0058): a signed-in caller can
-- never write founding_host_at or founding_number, on insert or update. Only the
-- allocation function below (service role, no auth.uid()) sets them.
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
     ) then
    raise exception 'founding host status is set by the server, not the client'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_founding_server_only on profiles;
create trigger profiles_founding_server_only
  before insert or update on profiles
  for each row
  execute function enforce_founding_server_only();

-- ------------------------------------------------------------------
-- The durable record of who the fifty are — the allocation authority.
--
-- A spot lives here, not only on the profile, because a profile does not last
-- forever: account deletion scrubs it and, for a host with no bookings yet, can
-- cascade it away. If allocation counted live profile rows, a departed Founding
-- Host would re-open their spot and the next host would be handed a number that
-- once belonged to somebody. This ledger never loses a row, so a consumed spot
-- stays consumed and numbers only ever climb.
--
-- Server-only: no end user reads or writes it. RLS is on with no policy, and the
-- grants are revoked, so only the definer functions below (running as owner)
-- ever touch it.
-- ------------------------------------------------------------------
create table if not exists founding_hosts (
  founding_number integer primary key check (founding_number between 1 and 50),
  -- The host who earned it, kept even after their account is gone. Deliberately
  -- no foreign key: the record must outlive the profile it names. One per host.
  host_id uuid not null unique,
  earned_at timestamptz not null default now()
);

alter table founding_hosts enable row level security;
revoke all on founding_hosts from anon, authenticated;

-- ------------------------------------------------------------------
-- Allocate a Founding Host spot, atomically.
--
-- A transaction-scoped advisory lock serialises every award, so the count read
-- and the number assigned cannot interleave — two hosts going live at the same
-- instant can never both take the last spot. The ledger's own primary key, its
-- unique host_id, and the 1..50 check are the backstop if that lock is ever
-- bypassed. Idempotent: a host already in the ledger keeps their original number
-- and moment, and the profile projection is refreshed in case it was lost.
-- ------------------------------------------------------------------
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

  -- Already one of the fifty? Keep it, and make sure the profile reflects it
  -- (covers a profile re-created after deletion). Never re-number, never re-open.
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
  if taken >= 50 then
    return;
  end if;

  -- The ledger never loses a row, so its highest number only grows: the next
  -- number cannot collide with one already consumed, even after a deletion.
  select coalesce(max(founding_number), 0) + 1 into next_num from founding_hosts;

  insert into founding_hosts (founding_number, host_id) values (next_num, p_host_id);

  -- Project onto the profile for the read paths, in this same transaction.
  update profiles
    set founding_number = next_num,
        founding_host_at = (select earned_at from founding_hosts where host_id = p_host_id)
    where id = p_host_id;
end;
$$;

revoke all on function award_founding_host(uuid) from public;
grant execute on function award_founding_host(uuid) to service_role;

-- How many Founding Host spots are left, counted from the durable ledger — never
-- a stored countdown, and never re-opened by a deletion. SECURITY DEFINER so the
-- same real, global count reaches every caller: profiles' RLS only lets a signed
-- in user see their own row, which would otherwise make an invoker count return
-- a private, wrong number. It exposes only the integer — no ledger row, no
-- profile data leaves this function.
create or replace function founding_hosts_remaining()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(0, 50 - (select count(*) from founding_hosts))::integer;
$$;

revoke all on function founding_hosts_remaining() from public;
grant execute on function founding_hosts_remaining() to anon, authenticated, service_role;

-- ------------------------------------------------------------------
-- The one qualifying moment, allocated in the same transaction.
--
-- Founding Host is earned when a host's first listing goes live — the moment a
-- space moves from pending to active. Rather than the approval route awarding
-- the spot in a second, best-effort call that could fail after the listing was
-- already live, the transition itself allocates the spot: an after-update
-- trigger on that exact change, calling the atomic function above inside the
-- approval's own transaction.
--
-- So the two cannot come apart. If allocation genuinely fails, the approval
-- rolls back with it and can be retried — a qualifying host is never left live
-- but skipped. If all fifty spots are gone, the function returns without a
-- number and the approval commits normally: not being in the first fifty is an
-- ordinary outcome, not an error. Relisting (delisted -> active) is not this
-- transition and does not fire, so earned status is never altered later. The
-- function is definer-run here so the allocation does not depend on which role
-- performed the approval.
-- ------------------------------------------------------------------
create or replace function allocate_founding_on_go_live()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform award_founding_host(new.host_id);
  return null;
end;
$$;

drop trigger if exists spaces_allocate_founding on spaces;
create trigger spaces_allocate_founding
  after update on spaces
  for each row
  when (old.status = 'pending' and new.status = 'active')
  execute function allocate_founding_on_go_live();

-- ------------------------------------------------------------------
-- One-time backfill for hosts already live when this ships.
--
-- The trigger above only fires on future approvals, so without this every host
-- already live would be passed over. This grants them their place, deterministic
-- and derived entirely from real rows — it invents no host and no number.
--
-- Qualification is a genuinely live listing (status 'active', which 0018 already
-- means a verified lease). Hosts are ordered by when their first such listing
-- went live: sublease_doc_reviewed_at is that moment exactly — the approval
-- route stamps it in the same write that sets status to active, and relisting
-- never rewrites it — with created_at as the safe factual fallback for any
-- pre-0018 listing that predates the review timestamp. One host takes one spot
-- however many rooms they hold (grouped by host), numbers run 1..50 and stop,
-- and a host who somehow already holds a valid assignment is left untouched.
-- Idempotent: run again and every qualifying host is already numbered, the
-- remaining candidates find no spots under fifty, and nothing changes.
-- ------------------------------------------------------------------
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
  where not exists (
    select 1 from founding_hosts fh where fh.host_id = q.host_id
  )
),
taken as (
  select count(*)::int as n from founding_hosts
),
ranked as (
  select c.host_id,
         c.went_live,
         row_number() over (order by c.went_live asc, c.host_id asc) as rn
  from candidates c
)
insert into founding_hosts (founding_number, host_id, earned_at)
select (select n from taken) + r.rn, r.host_id, r.went_live
from ranked r
where (select n from taken) + r.rn <= 50;

-- Project the ledger onto profiles for the read paths, without disturbing a host
-- who already carries a number.
update profiles p
set founding_number = fh.founding_number,
    founding_host_at = fh.earned_at
from founding_hosts fh
where fh.host_id = p.id
  and p.founding_number is null;

-- ------------------------------------------------------------------
-- A held session is a permanent fact — a milestone cannot un-earn.
--
-- Host achievements are read live from completed, captured bookings, and the
-- product rule is that a milestone once earned stays earned. Removal is already
-- impossible: bookings.space_id and bookings.practitioner_id are on delete
-- restrict, so a completed booking is never cascaded away and account deletion
-- is refused while one exists. This closes the other two doors — once a booking
-- is completed and its money captured, its status cannot leave 'completed' and
-- its capture cannot be cleared, and the row cannot be deleted directly either.
-- Every normal flow is untouched: the sweep only moves upcoming -> completed,
-- the webhook only sets captured_at, refunds and claims write neither, and the
-- booking roll-back paths only ever remove fresh, uncaptured holds. So this
-- refuses exactly the regressions that would silently lower a host's session
-- count, and nothing a live flow actually does.
-- ------------------------------------------------------------------
create or replace function keep_held_session_permanent()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'completed' and old.captured_at is not null then
      raise exception 'a completed, captured booking is a permanent record and cannot be deleted'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if old.status = 'completed' and old.captured_at is not null then
    if new.status is distinct from old.status then
      raise exception 'a completed booking cannot leave completed'
        using errcode = 'check_violation';
    end if;
    if new.captured_at is null then
      raise exception 'a captured booking cannot lose its capture'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_held_session_permanent on bookings;
create trigger bookings_held_session_permanent
  before update or delete on bookings
  for each row
  execute function keep_held_session_permanent();

-- ------------------------------------------------------------------
-- The host signals a practitioner may see, and only those.
--
-- Extends the narrowed view from 0004 — still only hosts with a live listing,
-- so a practitioner has no public presence and a host drops out the moment they
-- have no active space — with two signals: founding status, and the highest
-- session milestone reached. The milestone is a bucket
-- (0/1/10/50/100/250/500/1000), never the exact session count, so a browser
-- learns "100 Sessions" but not a host's precise volume. A session counts only
-- when completed and paid (status 'completed', captured_at set) — the same
-- truth host_bookings() and hostFactsFrom read. The buckets are pinned to
-- lib/host-achievements by host-achievements-sql-sync.test.ts.
-- ------------------------------------------------------------------
drop view if exists public_host_profiles;
create view public_host_profiles as
  select
    p.id,
    p.display_name,
    p.avatar_path,
    p.founding_host_at is not null as founding_host,
    (
      with sessions as (
        select count(*) as n
        from bookings b
        join spaces s on s.id = b.space_id
        where s.host_id = p.id
          and b.status = 'completed'
          and b.captured_at is not null
      )
      select case
        when n >= 1000 then 1000
        when n >= 500 then 500
        when n >= 250 then 250
        when n >= 100 then 100
        when n >= 50 then 50
        when n >= 10 then 10
        when n >= 1 then 1
        else 0
      end
      from sessions
    ) as session_milestone
  from profiles p
  where exists (
    select 1
    from spaces s
    where s.host_id = p.id
      and s.status = 'active'
  );

grant select on public_host_profiles to anon, authenticated;
