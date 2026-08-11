-- When a studio is left worse than it was found.
--
-- The mirror of 0033, pointing the other way, and built to the same rule:
-- nobody's card is charged on one side's account of events. A host reports, the
-- practitioner answers, a person decides. Reversing that — charge first, argue
-- later — is how a marketplace collects chargebacks instead of money, and at
-- this size one chargeback costs more than the claim it was meant to recover.
--
-- What is deliberately absent is any notion of us paying. We decide and we
-- collect; we do not guarantee. If the practitioner's card fails, the host is
-- told and given the record, and it is theirs and their insurer's to pursue. A
-- marketplace that tops up failed claims out of its own margin has quietly
-- become an insurer without pricing the risk.

do $$ begin
  create type claim_kind as enum ('cleaning', 'overstay', 'damage');
exception when duplicate_object then null; end $$;

do $$ begin
  create type claim_state as enum (
    'awaiting_practitioner', 'awaiting_staff', 'upheld', 'rejected', 'uncollectable'
  );
exception when duplicate_object then null; end $$;

create table if not exists studio_claims (
  id uuid primary key default gen_random_uuid(),

  -- One claim per booking, same as a refund request. A host who disagrees with
  -- the answer takes it up with a person rather than filing again.
  booking_id uuid not null unique references bookings (id) on delete cascade,
  host_id uuid not null references profiles (id) on delete cascade,

  kind claim_kind not null,
  detail text not null,
  -- Required for cleaning and damage. Enforced in the route, where the rule
  -- that decides it also lives — see claims.ts.
  evidence_path text,

  -- Only for overstay, and only as reported. What it costs is computed from
  -- the room's own rate rather than trusted from here.
  minutes_over integer,
  -- What the host says it will cost to put right. Null for the fixed kinds.
  claimed_cents integer,

  state claim_state not null default 'awaiting_practitioner',

  -- The practitioner's account of the same session.
  practitioner_reply text,
  practitioner_replied_at timestamptz,

  -- The decision.
  charged_cents integer,
  decided_by uuid references profiles (id),
  decided_at timestamptz,
  decision_note text,
  -- Set when the decision was made but the card would not pay. The host is
  -- owed nothing by us in that case, and this is how the screen says so.
  collection_error text,

  created_at timestamptz not null default now()
);

alter table studio_claims
  drop constraint if exists studio_claims_decision_complete;

alter table studio_claims
  add constraint studio_claims_decision_complete
  check (
    (state in ('awaiting_practitioner', 'awaiting_staff')
      and decided_at is null and decided_by is null and charged_cents is null)
    or
    (state in ('upheld', 'rejected', 'uncollectable')
      and decided_at is not null and decided_by is not null)
  );

-- Rejected means nothing was taken. Uncollectable means we tried and the card
-- refused — a distinction the host needs, because one is a judgement about
-- their claim and the other is not.
alter table studio_claims
  drop constraint if exists studio_claims_charge_matches_state;

alter table studio_claims
  add constraint studio_claims_charge_matches_state
  check (
    (state = 'rejected' and coalesce(charged_cents, 0) = 0)
    or (state = 'upheld' and charged_cents > 0)
    or (state = 'uncollectable' and coalesce(charged_cents, 0) = 0
        and collection_error is not null)
    or state in ('awaiting_practitioner', 'awaiting_staff')
  );

-- A host cannot invoice for time nobody spent, or for a negative amount.
alter table studio_claims
  drop constraint if exists studio_claims_amounts_sane;

alter table studio_claims
  add constraint studio_claims_amounts_sane
  check (
    (minutes_over is null or (minutes_over > 0 and minutes_over <= 600))
    and (claimed_cents is null or (claimed_cents > 0 and claimed_cents <= 1000000))
  );

create index if not exists studio_claims_open_idx
  on studio_claims (state, created_at)
  where state in ('awaiting_practitioner', 'awaiting_staff');

create index if not exists studio_claims_by_host_idx
  on studio_claims (host_id, created_at desc);

-- ------------------------------------------------------------------
-- Who sees what.
-- ------------------------------------------------------------------
alter table studio_claims enable row level security;

drop policy if exists "host reads their own claims" on studio_claims;
create policy "host reads their own claims"
  on studio_claims for select
  using (host_id = auth.uid());

/*
 * The practitioner reads the claim against them, through the booking.
 *
 * They are being asked to answer it, so they have to see it — but never by
 * host id, or somebody could read every claim a studio has ever filed and
 * answer the pattern rather than the session.
 */
drop policy if exists "practitioner reads claims against them" on studio_claims;
create policy "practitioner reads claims against them"
  on studio_claims for select
  using (
    exists (
      select 1 from bookings b
      where b.id = studio_claims.booking_id
        and b.practitioner_id = auth.uid()
    )
  );

-- Nothing is written from a browser. Filing checks the window, the booking and
-- the evidence; replying checks who is replying and that it is still open.
-- Both are the route's job, on the service key.
grant select on studio_claims to authenticated;
