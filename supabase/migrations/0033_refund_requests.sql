-- Asking for money back, with a reason attached.
--
-- The automatic rule covers one case: cancel 24 hours ahead, get the charge
-- back. Everything else had no path. Somebody who stood outside a locked door
-- had the same options as somebody who changed their mind — none — and the
-- terms meanwhile promised a goodwill credit that no code has ever written.
--
-- A reason from a fixed list rather than a paragraph, because a reason that
-- cannot be counted cannot be compared, and a marketplace that cannot compare
-- cannot see a pattern. The paragraph is kept as well, never instead.
--
-- What this table is really for is the part after the request: the host's
-- answer, and a decision with a name on it. A refund system that pays out on
-- one unchecked story gets farmed, and the person who pays for that is a host
-- who did nothing wrong.

do $$ begin
  create type refund_reason as enum (
    'no_access', 'not_as_described', 'double_booked', 'unsafe',
    'host_no_show', 'changed_plans', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type refund_state as enum (
    'awaiting_host', 'awaiting_staff', 'approved', 'refused'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type refund_outcome as enum ('full', 'our_fee', 'none');
exception when duplicate_object then null; end $$;

create table if not exists refund_requests (
  id uuid primary key default gen_random_uuid(),

  -- One request per booking. Somebody who disagrees with the answer takes it
  -- up with a person; they do not get to ask again with a better reason.
  booking_id uuid not null unique references bookings (id) on delete cascade,
  practitioner_id uuid not null references profiles (id) on delete cascade,

  reason refund_reason not null,
  -- In their own words, alongside the reason rather than instead of it.
  detail text not null,
  -- Storage path, for the reasons where a photograph settles it.
  evidence_path text,

  state refund_state not null default 'awaiting_staff',

  -- The host's account of the same events. Null until they answer, and the
  -- request moves on without them after HOST_REPLY_HOURS either way.
  host_reply text,
  host_replied_at timestamptz,

  -- The decision, and who made it.
  outcome refund_outcome,
  decided_by uuid references profiles (id),
  decided_at timestamptz,
  decision_note text,
  refunded_cents integer,

  created_at timestamptz not null default now()
);

-- A decision is a decision: it has an outcome, a time and a person, or it has
-- none of them. Half-written rows are how a refund gets paid twice.
alter table refund_requests
  drop constraint if exists refund_requests_decision_complete;

alter table refund_requests
  add constraint refund_requests_decision_complete
  check (
    (state in ('awaiting_host', 'awaiting_staff')
      and outcome is null and decided_at is null and decided_by is null)
    or
    (state in ('approved', 'refused')
      and outcome is not null and decided_at is not null and decided_by is not null)
  );

-- Approved means money moved, or moved to zero deliberately. Refused never
-- pays. Stated here so a bug in the route cannot write a contradiction.
alter table refund_requests
  drop constraint if exists refund_requests_outcome_matches_state;

alter table refund_requests
  add constraint refund_requests_outcome_matches_state
  check (
    state <> 'refused' or outcome = 'none'
  );

create index if not exists refund_requests_open_idx
  on refund_requests (state, created_at)
  where state in ('awaiting_host', 'awaiting_staff');

-- The count that makes a pattern visible, without a scan per request.
create index if not exists refund_requests_by_practitioner_idx
  on refund_requests (practitioner_id, created_at desc);

-- ------------------------------------------------------------------
-- Who may see and do what.
-- ------------------------------------------------------------------
alter table refund_requests enable row level security;

drop policy if exists "practitioner reads own refund requests" on refund_requests;
create policy "practitioner reads own refund requests"
  on refund_requests for select
  using (practitioner_id = auth.uid());

/*
 * The host reads the request against their own room, and nothing else.
 *
 * They are being asked to answer an account of events, so they have to see it
 * — but through the booking they own, never by practitioner id, or a host
 * could read every request that person has ever made and answer the pattern
 * rather than the day.
 */
drop policy if exists "host reads requests on their own rooms" on refund_requests;
create policy "host reads requests on their own rooms"
  on refund_requests for select
  using (
    exists (
      select 1 from bookings b
      join spaces s on s.id = b.space_id
      where b.id = refund_requests.booking_id
        and s.host_id = auth.uid()
    )
  );

/*
 * Nobody writes here from the browser. Not the practitioner, not the host.
 *
 * Creating a request has to check the booking was paid, that the window is
 * open, and how many have been asked before; a reply has to check who is
 * replying and that it is still open to replies. All of that is the route's
 * job, on the service key. An insert policy would be a second copy of those
 * rules, kept in a different language, drifting.
 */

grant select on refund_requests to authenticated;
