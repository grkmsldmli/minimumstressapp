-- Transactional messages, and the queue that stops them going twice.
--
-- The problem this table exists for: sending is not transactional. A booking
-- is written to Postgres and an email is handed to Resend, and no transaction
-- spans both — the same shape as the Stripe call in booking-service.ts. So a
-- retried job, a redeployed function or a timeout that actually delivered can
-- all send the same message again, and "your session is cancelled" arriving
-- twice is not a cosmetic bug.
--
-- The fix is a unique key per (what, about what, over which channel), claimed
-- before the send. A second attempt collides and stops. Delivery is therefore
-- at-least-once rather than exactly-once — a send that succeeds and then dies
-- before it can be marked will go again — which is the right way round: a
-- duplicate door code is an annoyance, a missing one is someone locked out.
--
-- The message body is deliberately NOT stored. It is rendered from live data
-- at send time, so a retry carries current truth rather than a stale snapshot,
-- and no door code is ever copied into a second table.

alter table profiles
  -- E.164, so the country code is never ambiguous. Verified separately from
  -- being present: an unverified number is somebody's typo until proven
  -- otherwise, and texting a stranger's phone is worse than sending nothing.
  add column if not exists phone text,
  add column if not exists phone_verified_at timestamptz,
  add column if not exists notify_sms boolean not null default false;

do $$
begin
  alter table profiles add constraint profiles_phone_is_e164
    check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type notification_channel as enum ('email', 'sms');
exception
  when duplicate_object then null;
end $$;

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  booking_id uuid references bookings (id) on delete cascade,
  kind text not null,
  channel notification_channel not null,

  -- The whole point of the table. Built by the caller as
  -- kind:subject-id:channel, so the same message about the same booking on the
  -- same channel can be claimed exactly once.
  dedupe_key text not null unique,

  attempts integer not null default 0,
  sent_at timestamptz,
  -- Set when a provider rejects in a way that will never succeed — a malformed
  -- address, an unreachable number. Distinct from "not sent yet" so a dead
  -- message stops being retried without pretending it was delivered.
  dropped_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

-- The queue's only hot query: what is still owed. Partial, because a delivered
-- notification is never looked up this way and there will be far more of those.
create index if not exists notifications_pending_idx
  on notifications (created_at)
  where sent_at is null and dropped_at is null;

create index if not exists notifications_user_idx on notifications (user_id, created_at desc);

-- ------------------------------------------------------------------
-- Access
--
-- Nobody reads this table from the client. It is written and read by the
-- service role alone, from the cron job and the booking paths — a practitioner
-- has no reason to enumerate what we have sent, and a host has less.
--
-- RLS on with no policy is the deliberate outcome: the base table denies
-- everyone, and the service role bypasses RLS entirely.
-- ------------------------------------------------------------------
alter table notifications enable row level security;

grant select, insert, update on notifications to service_role;
