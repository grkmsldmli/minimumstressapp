-- Referral rewards — a durable, append-only ledger. $25 to the referrer only.
--
-- A reward exists only once a referral has reached its authoritative qualified
-- state (referrals.qualified_at, set on the referred host's first completed and
-- captured hosted booking — migration 0061). Never at click, signup,
-- attribution, listing creation, or listing approval.
--
-- The shape follows credit_ledger, the platform's other money ledger: append
-- only, one row per event, amount frozen at creation, `on delete restrict` so a
-- financial record cannot be cascaded away, and totals read by summing the rows
-- rather than any stored balance that could drift. No money moves here — see the
-- report for why a $25 reward cannot reuse the booking payout path (which is
-- charge-funded via source_transaction) and what a separate payout integration
-- would need. Until then a reward is 'earned', never 'paid'.

create table if not exists referral_rewards (
  id uuid primary key default gen_random_uuid(),
  -- Exactly one reward per referral, anchored to its stable id. Restrict, not
  -- cascade: a referral is a durable record and a reward pins it further.
  referral_id uuid not null unique references referrals (id) on delete restrict,
  -- The owed party, frozen at creation. Restrict mirrors bookings and
  -- credit_ledger: a financial record keeps an account from vanishing under it.
  referrer_id uuid not null references profiles (id) on delete restrict,
  -- Frozen at creation. No code path updates it, so the amount a referral earned
  -- is whatever it earned the day it qualified.
  amount_cents integer not null default 2500 check (amount_cents >= 0),
  created_at timestamptz not null default now(),
  -- No money has moved at launch, so every reward is 'earned'. A later payout
  -- package flips it to 'paid' with the transfer evidence beside it. 'paid' and
  -- paid_at move together, so the state can never claim a payment it cannot show.
  payout_state text not null default 'earned' check (payout_state in ('earned', 'paid')),
  paid_at timestamptz,
  stripe_transfer_id text,
  constraint referral_rewards_paid_consistent check ((payout_state = 'paid') = (paid_at is not null))
);

create index if not exists referral_rewards_referrer_idx on referral_rewards (referrer_id);

-- Server-only, like the referral ledgers it reads from. RLS on with no policy
-- and grants revoked: a client can neither read the ledger nor forge, alter, or
-- delete a reward. Only the definer trigger and backfill below write it.
alter table referral_rewards enable row level security;
revoke all on referral_rewards from anon, authenticated;

-- ------------------------------------------------------------------
-- Create the reward the moment a referral qualifies — exactly once.
--
-- Fires only on the qualified_at transition null -> not null, which
-- mark_referral_qualified (0061) performs exactly once, guarded by qualified_at
-- being null. The UNIQUE(referral_id) and ON CONFLICT make it idempotent
-- besides, so a retried webhook, a second booking, or a re-run backfill can
-- never mint a second reward. A referrer whose account is already gone earns
-- nothing — and, just as important, qualification must not fail on a dangling
-- reference, so the reward is skipped rather than raised.
--
-- Account existence is auth.users, not profiles: account deletion
-- (lib/account-deletion) deletes the auth user but deliberately RETAINS the
-- scrubbed profile row as a foreign-key target for financial history, so a
-- profiles check would wrongly count a deleted referrer as present and reward
-- them. Definer-run, so it may read auth.users; it exposes nothing — only the
-- existence answer is used, internally.
-- ------------------------------------------------------------------
create or replace function create_referral_reward()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from auth.users where id = new.referrer_id) then
    return null;
  end if;

  insert into referral_rewards (referral_id, referrer_id, amount_cents)
    values (new.id, new.referrer_id, 2500)
    on conflict (referral_id) do nothing;
  return null;
end;
$$;

revoke all on function create_referral_reward() from public;

drop trigger if exists referrals_reward_on_qualify on referrals;
create trigger referrals_reward_on_qualify
  after update on referrals
  for each row
  when (old.qualified_at is null and new.qualified_at is not null)
  execute function create_referral_reward();

-- ------------------------------------------------------------------
-- One-time backfill for referrals already qualified when this ships.
--
-- Every referral that has genuinely reached qualified_at earns its one reward,
-- dated to when it qualified — nothing is fabricated for a referral that never
-- did. The join to auth.users skips a referrer whose account has been deleted
-- (the same rule as the trigger: a deleted account keeps a scrubbed profile but
-- loses its auth user), and ON CONFLICT makes a re-run change nothing.
-- Deterministic and idempotent.
-- ------------------------------------------------------------------
insert into referral_rewards (referral_id, referrer_id, amount_cents, created_at)
select r.id, r.referrer_id, 2500, r.qualified_at
from referrals r
join auth.users u on u.id = r.referrer_id
where r.qualified_at is not null
on conflict (referral_id) do nothing;

-- ------------------------------------------------------------------
-- The caller's own rewards, keyed by the referral they belong to.
--
-- A separate reader rather than a change to my_referrals (0061), so the shipped
-- function keeps its signature and the migration sequence stays re-runnable. The
-- app joins these onto its referral list by id. Each row is one reward: its
-- amount, and its payout state — 'earned' until a later payout package pays it,
-- then 'paid'. Scoped to the caller's own rewards; no referred-host id or other
-- private data leaves the database, and totals are summed from these real rows.
-- ------------------------------------------------------------------
create or replace function my_referral_rewards()
returns table (
  referral_id uuid,
  amount_cents integer,
  payout_state text
)
language sql
stable
security definer
set search_path = public
as $$
  select rw.referral_id, rw.amount_cents, rw.payout_state
  from referral_rewards rw
  where rw.referrer_id = auth.uid();
$$;

revoke all on function my_referral_rewards() from public;
grant execute on function my_referral_rewards() to authenticated;
