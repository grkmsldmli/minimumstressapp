-- User-safety controls for booking messaging (App Store Guideline 1.2).
--
-- The app has one user-to-user surface — the per-booking message thread — so the
-- store requires a way to report the other party and to block an abusive one.
-- Both are kept narrowly booking-related; this is not a social network.
--
-- Nothing here touches a booking's records or its access details. The address
-- and door code come from space_access_details(), not from messaging, so a block
-- severs the chat without ever stranding someone at a locked door, and a report
-- stores who / which booking / why — never an address, a code, or a message.

-- ------------------------------------------------------------------
-- 1. Blocks. A user severs the message channel with another.
--
-- Written only by the service role behind /api/messages/block, which verifies
-- the caller is a participant and derives who to block from booking truth — the
-- same reason messages themselves are service-role-only (0063). So no client
-- grant and no policy: anon and authenticated can neither read nor write blocks,
-- and RLS stays on as a second wall. The send guard below reads this table when
-- a message is inserted, which also runs as the service role.
-- ------------------------------------------------------------------
create table if not exists blocked_users (
  blocker_id uuid not null references profiles(id) on delete cascade,
  blocked_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

alter table blocked_users enable row level security;
revoke all on blocked_users from anon, authenticated;
grant select, insert, delete on blocked_users to service_role;

-- ------------------------------------------------------------------
-- 2. Reports. A booking participant reports the other party.
--
-- Also service-role-only, behind /api/messages/report: the route checks
-- participation and derives the reported party, so a client never writes a
-- report directly (which would let anyone file against anyone) and never reads
-- one (staff review with the service role). Attempting a report client-side is
-- refused at the grant, before RLS.
-- ------------------------------------------------------------------
create table if not exists message_reports (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  reporter_id uuid not null references profiles(id) on delete cascade,
  reported_user_id uuid not null references profiles(id) on delete cascade,
  reason text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  check (char_length(reason) between 1 and 2000),
  check (status in ('open', 'reviewing', 'closed'))
);

create index if not exists message_reports_open_idx
  on message_reports (created_at)
  where status = 'open';

alter table message_reports enable row level security;
revoke all on message_reports from anon, authenticated;
grant select, insert on message_reports to service_role;

-- ------------------------------------------------------------------
-- 3. A block severs the channel. The send guard already gates on a confirmed,
--    uncancelled booking (0063); extend it so neither party can post once either
--    has blocked the other. The booking, its records and its access details are
--    untouched — only the chat closes.
-- ------------------------------------------------------------------
create or replace function enforce_message_sendable()
returns trigger
language plpgsql
as $$
declare
  b record;
  practitioner uuid;
  host uuid;
begin
  select captured_at, status into b from bookings where id = new.booking_id;
  if b is null
     or b.captured_at is null
     or b.status in ('cancelled_by_practitioner', 'cancelled_by_host') then
    raise exception 'messaging is available only on a confirmed booking'
      using errcode = 'check_violation';
  end if;

  select bk.practitioner_id, sp.host_id into practitioner, host
  from bookings bk join spaces sp on sp.id = bk.space_id
  where bk.id = new.booking_id;

  if exists (
    select 1 from blocked_users
    where (blocker_id = practitioner and blocked_id = host)
       or (blocker_id = host and blocked_id = practitioner)
  ) then
    raise exception 'messaging is unavailable for this booking'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- The trigger from 0063 already calls enforce_message_sendable(); replacing the
-- function is enough.
