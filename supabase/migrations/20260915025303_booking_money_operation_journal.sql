-- Stripe and Postgres cannot share a transaction.  This journal is the durable
-- seam between them: every refund, cancellation settlement and host transfer
-- is claimed in Postgres before Stripe is touched, then completed under the
-- same lease token only after Stripe returns a verifiable provider object.
--
-- A lease may expire and let another worker resume the SAME operation.  It
-- never permits a different kind of operation on the booking: Stripe may have
-- accepted the first request just before the worker died, so treating a timeout
-- as proof that nothing happened would re-open the exact race this table closes.

create table if not exists public.booking_money_operations (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete restrict,
  refund_request_id uuid unique references public.refund_requests (id) on delete restrict,

  kind text not null check (kind in ('payout', 'cancellation', 'refund_request')),
  state text not null default 'claimed'
    check (state in ('claimed', 'provider_pending', 'committed', 'manual_review')),
  operation_key text not null unique,

  -- The decision and provider inputs are frozen with the claim.  A later retry
  -- therefore cannot silently pick up a changed account, amount or outcome.
  requested_outcome public.refund_outcome,
  decision_actor_id uuid,
  decision_note text,
  cancellation_actor public.cancelled_by_actor,
  provider_action text not null
    check (provider_action in ('transfer', 'refund', 'reverse_and_refund', 'cancel_intent', 'none')),
  space_id uuid not null,
  practitioner_id uuid not null,
  payment_intent_id text,
  source_transfer_id text,
  destination_account_id text,
  host_rate_cents integer not null check (host_rate_cents >= 0),
  service_fee_cents integer not null check (service_fee_cents >= 0),
  instant_fee_cents integer not null check (instant_fee_cents >= 0),
  pro_discount_cents integer not null check (pro_discount_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  platform_cents integer not null,
  refunded_before_cents integer not null default 0 check (refunded_before_cents >= 0),
  expected_transfer_cents integer not null default 0 check (expected_transfer_cents >= 0),
  expected_refund_cents integer not null default 0 check (expected_refund_cents >= 0),
  expected_reversal_cents integer not null default 0 check (expected_reversal_cents >= 0),
  expected_charged_cents integer not null default 0 check (expected_charged_cents >= 0),

  -- Provider receipts.  These are nullable while a worker is between claim and
  -- Stripe, and become durable in the same transaction as the booking result.
  stripe_transfer_id text,
  stripe_refund_id text,
  stripe_reversal_id text,
  provider_status text,
  provider_paid_cents integer check (provider_paid_cents is null or provider_paid_cents >= 0),

  attempts integer not null default 1 check (attempts >= 1),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,

  constraint booking_money_operations_lease_pair check (
    (lease_token is null) = (lease_until is null)
  ),
  constraint booking_money_operations_subject check (
    (kind = 'refund_request' and refund_request_id is not null and requested_outcome is not null)
    or (kind <> 'refund_request' and refund_request_id is null and requested_outcome is null)
  ),
  constraint booking_money_operations_terminal check (
    (state = 'committed' and completed_at is not null and lease_token is null)
    or (state <> 'committed' and completed_at is null)
  )
);

-- Belt-and-braces beside bookings.active_money_operation_id: even a future RPC
-- that forgets the pointer cannot create two in-flight money decisions.
create unique index if not exists booking_money_operations_one_active_per_booking
  on public.booking_money_operations (booking_id)
  where state <> 'committed';

create index if not exists booking_money_operations_retry_idx
  on public.booking_money_operations (next_attempt_at, created_at)
  where state in ('claimed', 'provider_pending');

alter table public.bookings
  add column if not exists active_money_operation_id uuid
    references public.booking_money_operations (id) on delete restrict;

create unique index if not exists bookings_active_money_operation_idx
  on public.bookings (active_money_operation_id)
  where active_money_operation_id is not null;

comment on column public.bookings.active_money_operation_id is
  'The refund/cancellation/payout that exclusively owns this booking until it commits or is manually resolved.';

alter table public.booking_money_operations enable row level security;
revoke all on table public.booking_money_operations from public, anon, authenticated;
grant select, insert, update on table public.booking_money_operations to service_role;
revoke update (active_money_operation_id) on public.bookings from authenticated;

-- PR1's older booking-level resolver can still own an approval/cancellation
-- hold while this migration is being rolled out.  This helper is deliberately
-- dynamic: the journal migration also applies cleanly before that PR lands,
-- while the final ordered schema fails closed whenever its columns exist.
create or replace function public.booking_money_operation_may_claim(
  p_booking_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'bookings'
      and a.attname = 'financial_resolution_state'
      and a.attnum > 0
      and not a.attisdropped
  ) then
    return true;
  end if;

  execute
    'select financial_resolution_state from public.bookings where id = $1'
    into v_state
    using p_booking_id;

  return coalesce(v_state in ('not_required', 'resolved'), false);
end;
$$;

revoke all on function public.booking_money_operation_may_claim(uuid)
  from public, anon, authenticated;
grant execute on function public.booking_money_operation_may_claim(uuid)
  to service_role;

-- Keep the older booking-level operator queue aligned with the journal.  The
-- migration is intentionally compatible with either stacking order, so the
-- projection is dynamic when the legacy columns have not landed yet.
create or replace function public.project_booking_money_manual_review(
  p_booking_id uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'bookings'
      and a.attname = 'financial_resolution_state'
      and a.attnum > 0
      and not a.attisdropped
  ) then
    execute $legacy$
      update public.bookings
      set financial_resolution_state = 'manual_review',
          financial_resolution_next_attempt_at = null,
          financial_resolution_last_error = left(coalesce($2, 'Money journal requires manual review'), 500),
          financial_resolved_at = null,
          financial_resolution_lease_token = null,
          financial_resolution_lease_until = null
      where id = $1
    $legacy$ using p_booking_id, p_error;
  end if;
end;
$$;

revoke all on function public.project_booking_money_manual_review(uuid, text)
  from public, anon, authenticated;
grant execute on function public.project_booking_money_manual_review(uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Claims
-- ---------------------------------------------------------------------------

create or replace function public.claim_booking_payout(
  p_booking_id uuid,
  p_lease_token uuid,
  p_now timestamptz default now()
)
returns setof public.booking_money_operations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings%rowtype;
  v_operation public.booking_money_operations%rowtype;
  v_destination text;
begin
  if p_lease_token is null then
    raise exception 'p_lease_token is required';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then return; end if;

  if not public.booking_money_operation_may_claim(v_booking.id) then return; end if;

  if v_booking.active_money_operation_id is not null then
    select * into v_operation
    from public.booking_money_operations
    where id = v_booking.active_money_operation_id
    for update;

    if v_operation.kind <> 'payout'
      or v_operation.state = 'manual_review'
      or (v_operation.lease_until is not null and v_operation.lease_until > p_now)
    then
      return;
    end if;

    update public.booking_money_operations
    set lease_token = p_lease_token,
        lease_until = p_now + interval '10 minutes',
        attempts = attempts + 1,
        updated_at = p_now
    where id = v_operation.id
      and state in ('claimed', 'provider_pending')
    returning * into v_operation;
    if found then return next v_operation; end if;
    return;
  end if;

  -- Paid only after the booked hour has ended.  This makes cancellation and
  -- payout temporally disjoint as well as serialized by the row lock.
  if v_booking.ends_at > p_now
    or v_booking.captured_at is null
    or v_booking.host_paid_at is not null
    or v_booking.host_rate_refunded is true
    or v_booking.stripe_payment_intent_id is null
    or v_booking.status not in ('upcoming', 'completed', 'cancelled_by_practitioner', 'no_show')
  then
    return;
  end if;

  select p.stripe_connect_account_id into v_destination
  from public.spaces s
  join public.profiles p on p.id = s.host_id
  where s.id = v_booking.space_id;

  if v_destination is null then return; end if;

  insert into public.booking_money_operations (
    booking_id, kind, operation_key, provider_action,
    space_id, practitioner_id, payment_intent_id, destination_account_id,
    host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents,
    total_cents, platform_cents,
    refunded_before_cents, expected_transfer_cents,
    lease_token, lease_until, next_attempt_at, created_at, updated_at
  ) values (
    v_booking.id, 'payout', 'booking:' || v_booking.id::text || ':payout', 'transfer',
    v_booking.space_id, v_booking.practitioner_id, v_booking.stripe_payment_intent_id,
    v_destination, v_booking.host_rate_cents, v_booking.service_fee_cents,
    v_booking.instant_fee_cents, v_booking.pro_discount_cents,
    v_booking.total_cents, v_booking.platform_cents,
    coalesce(v_booking.refunded_cents, 0), v_booking.host_rate_cents,
    p_lease_token, p_now + interval '10 minutes', p_now, p_now, p_now
  )
  returning * into v_operation;

  update public.bookings
  set active_money_operation_id = v_operation.id
  where id = v_booking.id;

  return next v_operation;
end;
$$;

create or replace function public.claim_booking_cancellation(
  p_booking_id uuid,
  p_actor public.cancelled_by_actor,
  p_requester_id uuid,
  p_provider_action text,
  p_expected_refund_cents integer,
  p_expected_charged_cents integer,
  p_lease_token uuid,
  p_now timestamptz default now()
)
returns setof public.booking_money_operations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings%rowtype;
  v_operation public.booking_money_operations%rowtype;
  v_host_id uuid;
begin
  if p_lease_token is null then
    raise exception 'p_lease_token is required';
  end if;
  if p_actor is null or p_requester_id is null then return; end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;
  if not found then return; end if;

  if not public.booking_money_operation_may_claim(v_booking.id) then return; end if;

  select host_id into v_host_id from public.spaces where id = v_booking.space_id;
  if (p_actor = 'practitioner' and v_booking.practitioner_id <> p_requester_id)
    or (p_actor = 'host' and v_host_id <> p_requester_id)
  then
    return;
  end if;

  if v_booking.active_money_operation_id is not null then
    select * into v_operation from public.booking_money_operations
    where id = v_booking.active_money_operation_id for update;
    if v_operation.kind <> 'cancellation'
      or v_operation.cancellation_actor <> p_actor
      or v_operation.provider_action <> p_provider_action
      or v_operation.expected_refund_cents <> p_expected_refund_cents
      or v_operation.state = 'manual_review'
      or (v_operation.lease_until is not null and v_operation.lease_until > p_now)
    then
      return;
    end if;
    update public.booking_money_operations
    set lease_token = p_lease_token,
        lease_until = p_now + interval '10 minutes',
        attempts = attempts + 1,
        updated_at = p_now
    where id = v_operation.id and state in ('claimed', 'provider_pending')
    returning * into v_operation;
    if found then return next v_operation; end if;
    return;
  end if;

  -- Once the session starts it belongs to completion/no-show/refund handling,
  -- not the cancellation policy.  The payout claim begins only after ends_at.
  if v_booking.status <> 'upcoming' or v_booking.starts_at <= p_now then return; end if;

  if p_expected_refund_cents < 0
    or p_expected_refund_cents > v_booking.total_cents - coalesce(v_booking.refunded_cents, 0)
    or p_expected_charged_cents < 0
    or p_expected_charged_cents > v_booking.total_cents
    -- A booking without a PaymentIntent never charged Stripe. Its cancellation
    -- truth is therefore zero refunded and zero charged. A live intent keeps
    -- the ordinary conservation equation: refund + charged = total.
    or (
      v_booking.stripe_payment_intent_id is null
      and (
        p_provider_action <> 'none'
        or p_expected_refund_cents <> 0
        or p_expected_charged_cents <> 0
      )
    )
    or (
      v_booking.stripe_payment_intent_id is not null
      and p_expected_refund_cents <> greatest(
        0,
        v_booking.total_cents - p_expected_charged_cents
      )
    )
  then
    return;
  end if;

  if (p_provider_action = 'refund' and (p_expected_refund_cents <= 0 or v_booking.captured_at is null))
    or (p_provider_action = 'cancel_intent' and (v_booking.captured_at is not null or v_booking.stripe_payment_intent_id is null))
    or (p_provider_action = 'none' and p_expected_refund_cents <> 0)
    or p_provider_action not in ('refund', 'cancel_intent', 'none')
  then
    return;
  end if;

  insert into public.booking_money_operations (
    booking_id, kind, operation_key, cancellation_actor, provider_action,
    space_id, practitioner_id, payment_intent_id,
    host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents,
    total_cents, platform_cents,
    refunded_before_cents, expected_refund_cents, expected_charged_cents,
    lease_token, lease_until, next_attempt_at, created_at, updated_at
  ) values (
    v_booking.id, 'cancellation', 'booking:' || v_booking.id::text || ':cancellation',
    p_actor, p_provider_action, v_booking.space_id, v_booking.practitioner_id,
    v_booking.stripe_payment_intent_id, v_booking.host_rate_cents,
    v_booking.service_fee_cents, v_booking.instant_fee_cents,
    v_booking.pro_discount_cents, v_booking.total_cents, v_booking.platform_cents,
    coalesce(v_booking.refunded_cents, 0),
    p_expected_refund_cents, p_expected_charged_cents,
    p_lease_token, p_now + interval '10 minutes', p_now, p_now, p_now
  ) returning * into v_operation;

  update public.bookings set active_money_operation_id = v_operation.id
  where id = v_booking.id;
  return next v_operation;
end;
$$;

create or replace function public.claim_refund_decision(
  p_request_id uuid,
  p_decision_actor_id uuid,
  p_outcome public.refund_outcome,
  p_note text,
  p_lease_token uuid,
  p_now timestamptz default now()
)
returns setof public.booking_money_operations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.refund_requests%rowtype;
  v_booking public.bookings%rowtype;
  v_operation public.booking_money_operations%rowtype;
  v_booking_id uuid;
  v_refund integer;
  v_reversal integer;
begin
  if p_lease_token is null then
    raise exception 'p_lease_token is required';
  end if;
  if p_decision_actor_id is null or p_outcome is null then return; end if;

  -- Read the booking id, then take every money lock in booking->request order.
  select booking_id into v_booking_id from public.refund_requests where id = p_request_id;
  if v_booking_id is null then return; end if;

  select * into v_booking from public.bookings where id = v_booking_id for update;
  select * into v_request from public.refund_requests
  where id = p_request_id and booking_id = v_booking_id for update;
  if not found then return; end if;

  if not public.booking_money_operation_may_claim(v_booking.id) then return; end if;

  select * into v_operation from public.booking_money_operations
  where refund_request_id = p_request_id for update;

  if found then
    if v_operation.requested_outcome <> p_outcome
      or v_operation.state = 'manual_review'
      or v_operation.state = 'committed'
      or (v_operation.lease_until is not null and v_operation.lease_until > p_now)
    then
      return;
    end if;
    update public.booking_money_operations
    set lease_token = p_lease_token,
        lease_until = p_now + interval '10 minutes',
        attempts = attempts + 1,
        updated_at = p_now
    where id = v_operation.id and state in ('claimed', 'provider_pending')
    returning * into v_operation;
    if found then return next v_operation; end if;
    return;
  end if;

  if v_request.state not in ('awaiting_host', 'awaiting_staff') then return; end if;
  if v_booking.active_money_operation_id is not null then return; end if;

  v_refund := case p_outcome
    when 'full' then v_booking.total_cents
    when 'our_fee' then v_booking.total_cents - v_booking.host_rate_cents
    else 0
  end;

  if p_outcome = 'none' then
    insert into public.booking_money_operations (
      booking_id, refund_request_id, kind, state, operation_key,
      requested_outcome, decision_actor_id, decision_note, provider_action,
      space_id, practitioner_id, payment_intent_id,
      host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents,
      total_cents, platform_cents,
      lease_token, lease_until, completed_at, created_at, updated_at
    ) values (
      v_booking.id, v_request.id, 'refund_request', 'committed',
      'refund_request:' || v_request.id::text, p_outcome, p_decision_actor_id,
      p_note, 'none', v_booking.space_id, v_booking.practitioner_id,
      v_booking.stripe_payment_intent_id, v_booking.host_rate_cents,
      v_booking.service_fee_cents, v_booking.instant_fee_cents,
      v_booking.pro_discount_cents, v_booking.total_cents, v_booking.platform_cents,
      null, null, p_now, p_now, p_now
    ) returning * into v_operation;

    update public.refund_requests
    set state = 'refused', outcome = 'none', decided_by = p_decision_actor_id,
        decided_at = p_now, decision_note = p_note, refunded_cents = 0
    where id = v_request.id;
    return next v_operation;
    return;
  end if;

  if v_booking.captured_at is null or v_booking.stripe_payment_intent_id is null
    or v_refund <= 0
    or v_refund > v_booking.total_cents - coalesce(v_booking.refunded_cents, 0)
  then
    return;
  end if;

  v_reversal := case
    when p_outcome = 'full' and v_booking.host_paid_at is not null
      then v_booking.host_rate_cents
    else 0
  end;

  if v_reversal > 0 and v_booking.stripe_transfer_id is null then return; end if;

  insert into public.booking_money_operations (
    booking_id, refund_request_id, kind, operation_key,
    requested_outcome, decision_actor_id, decision_note, provider_action,
    space_id, practitioner_id, payment_intent_id, source_transfer_id,
    host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents,
    total_cents, platform_cents,
    refunded_before_cents, expected_refund_cents, expected_reversal_cents,
    lease_token, lease_until, next_attempt_at, created_at, updated_at
  ) values (
    v_booking.id, v_request.id, 'refund_request',
    'refund_request:' || v_request.id::text, p_outcome, p_decision_actor_id,
    p_note, case when v_reversal > 0 then 'reverse_and_refund' else 'refund' end,
    v_booking.space_id, v_booking.practitioner_id, v_booking.stripe_payment_intent_id,
    v_booking.stripe_transfer_id, v_booking.host_rate_cents,
    v_booking.service_fee_cents, v_booking.instant_fee_cents,
    v_booking.pro_discount_cents, v_booking.total_cents, v_booking.platform_cents,
    coalesce(v_booking.refunded_cents, 0),
    v_refund, v_reversal, p_lease_token, p_now + interval '10 minutes',
    p_now, p_now, p_now
  ) returning * into v_operation;

  update public.bookings set active_money_operation_id = v_operation.id
  where id = v_booking.id;
  return next v_operation;
end;
$$;

-- ---------------------------------------------------------------------------
-- Retry lease and failure state
-- ---------------------------------------------------------------------------

create or replace function public.claim_booking_money_operation_retries(
  p_worker uuid,
  p_limit integer default 25,
  p_now timestamptz default now()
)
returns setof public.booking_money_operations
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_worker is null then
    raise exception 'p_worker is required';
  end if;

  if p_limit < 1 or p_limit > 100 then
    raise exception 'p_limit must be between 1 and 100';
  end if;

  return query
  with due as (
    select o.id
    from public.booking_money_operations o
    join public.bookings b on b.id = o.booking_id
    where o.state in ('claimed', 'provider_pending')
      and o.next_attempt_at <= p_now
      and (o.lease_until is null or o.lease_until <= p_now)
      and b.active_money_operation_id = o.id
      and public.booking_money_operation_may_claim(b.id)
    order by o.next_attempt_at, o.created_at
    for update of o skip locked
    limit p_limit
  )
  update public.booking_money_operations o
  set lease_token = p_worker,
      lease_until = p_now + interval '10 minutes',
      attempts = o.attempts + 1,
      updated_at = p_now
  from due
  where o.id = due.id
  returning o.*;
end;
$$;

create or replace function public.fail_booking_money_operation(
  p_operation_id uuid,
  p_lease_token uuid,
  p_error text,
  p_manual_review boolean default false,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_manual boolean;
  v_booking_id uuid;
begin
  select (p_manual_review or attempts >= 8), booking_id
    into v_manual, v_booking_id
  from public.booking_money_operations
  where id = p_operation_id
    and lease_token = p_lease_token
    and state in ('claimed', 'provider_pending')
  for update;
  if not found then return false; end if;

  update public.booking_money_operations
  set state = case when v_manual then 'manual_review' else state end,
      last_error = left(coalesce(p_error, 'Provider operation could not be confirmed'), 500),
      next_attempt_at = case
        when v_manual then next_attempt_at
        else p_now + make_interval(mins => least(60, (power(2, least(attempts, 6)))::integer))
      end,
      lease_token = null,
      lease_until = null,
      updated_at = p_now
  where id = p_operation_id and lease_token = p_lease_token;
  if not found then return false; end if;

  -- Transient journal retries deliberately do not enter the old worker, which
  -- does not understand provider correlation. Permanent ambiguity does.
  if v_manual then
    perform public.project_booking_money_manual_review(
      v_booking_id,
      'Money journal requires manual review'
    );
  end if;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fenced completion.  Provider receipt and domain truth commit together.
-- ---------------------------------------------------------------------------

create or replace function public.complete_booking_payout(
  p_operation_id uuid,
  p_lease_token uuid,
  p_transfer_id text,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.booking_money_operations%rowtype;
  v_booking public.bookings%rowtype;
begin
  select * into v_operation from public.booking_money_operations
  where id = p_operation_id and lease_token = p_lease_token
    and kind = 'payout' and state = 'claimed' for update;
  if not found then return false; end if;
  select * into v_booking from public.bookings where id = v_operation.booking_id for update;

  if p_transfer_id is null or p_transfer_id = ''
    or v_booking.active_money_operation_id <> v_operation.id
    or v_booking.host_paid_at is not null
    or v_booking.host_rate_refunded is true
    or v_booking.captured_at is null
    or v_booking.status not in ('upcoming', 'completed', 'cancelled_by_practitioner', 'no_show')
  then
    update public.booking_money_operations
    set state = 'manual_review', last_error = 'Booking changed before payout completion',
        stripe_transfer_id = nullif(p_transfer_id, ''),
        provider_status = case
          when p_transfer_id is not null and p_transfer_id <> '' then 'succeeded'
          else provider_status
        end,
        lease_token = null, lease_until = null, updated_at = p_now
    where id = v_operation.id;
    perform public.project_booking_money_manual_review(
      v_booking.id,
      'Booking changed after Stripe payout succeeded'
    );
    return false;
  end if;

  update public.bookings
  set host_paid_at = p_now,
      stripe_transfer_id = p_transfer_id,
      status = case when status = 'upcoming' then 'completed' else status end,
      active_money_operation_id = null
  where id = v_booking.id;

  update public.booking_money_operations
  set state = 'committed', stripe_transfer_id = p_transfer_id,
      provider_status = 'succeeded', completed_at = p_now,
      lease_token = null, lease_until = null, last_error = null, updated_at = p_now
  where id = v_operation.id;
  return true;
end;
$$;

create or replace function public.complete_booking_cancellation(
  p_operation_id uuid,
  p_lease_token uuid,
  p_refund_id text,
  p_provider_status text,
  p_payment_intent_status text,
  p_paid_cents integer,
  p_refunded_cents integer,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.booking_money_operations%rowtype;
  v_booking public.bookings%rowtype;
begin
  select * into v_operation from public.booking_money_operations
  where id = p_operation_id and lease_token = p_lease_token
    and kind = 'cancellation' and state in ('claimed', 'provider_pending') for update;
  if not found then return false; end if;
  select * into v_booking from public.bookings where id = v_operation.booking_id for update;

  if p_refund_id is not null
    and p_provider_status in ('pending', 'requires_action')
  then
    update public.booking_money_operations
    set state = 'provider_pending', stripe_refund_id = p_refund_id,
        provider_status = p_provider_status, provider_paid_cents = p_paid_cents,
        next_attempt_at = p_now + interval '5 minutes',
        lease_token = null, lease_until = null, updated_at = p_now
    where id = v_operation.id;
    return false;
  end if;

  if v_booking.active_money_operation_id <> v_operation.id
    or v_booking.status <> 'upcoming'
    or coalesce(v_booking.refunded_cents, 0) <> v_operation.refunded_before_cents
    or p_paid_cents not in (0, v_booking.total_cents)
    or (p_paid_cents = 0 and (
      p_payment_intent_status not in ('canceled', 'not_required') or p_refunded_cents <> 0
    ))
    or (p_paid_cents = v_booking.total_cents and v_operation.expected_refund_cents > 0 and (
      p_provider_status <> 'succeeded' or p_refund_id is null
      or p_refunded_cents <> v_operation.expected_refund_cents
    ))
    or (p_paid_cents = v_booking.total_cents and v_operation.expected_refund_cents = 0
      and (p_payment_intent_status <> 'succeeded' or p_refunded_cents <> 0))
  then
    update public.booking_money_operations
    set state = 'manual_review', stripe_refund_id = p_refund_id,
        provider_status = p_provider_status, provider_paid_cents = p_paid_cents,
        last_error = 'Provider result did not match the claimed cancellation',
        lease_token = null, lease_until = null, updated_at = p_now
    where id = v_operation.id;
    perform public.project_booking_money_manual_review(
      v_booking.id,
      'Provider result did not match the claimed cancellation'
    );
    return false;
  end if;

  update public.bookings
  set status = case when v_operation.cancellation_actor = 'host'
      then 'cancelled_by_host'::public.booking_status
      else 'cancelled_by_practitioner'::public.booking_status end,
      cancelled_at = p_now,
      cancelled_by = v_operation.cancellation_actor,
      captured_at = case when p_paid_cents > 0 then coalesce(captured_at, p_now) else captured_at end,
      refunded_at = case when p_refunded_cents > 0 then p_now else refunded_at end,
      refunded_cents = case when p_refunded_cents > 0
        then v_operation.refunded_before_cents + p_refunded_cents
        else refunded_cents end,
      active_money_operation_id = null
  where id = v_booking.id;

  -- PR1's receipt loaders intentionally require resolved provider money.  Set
  -- that legacy projection only after this transaction has persisted Stripe's
  -- actual paid/refunded truth; until then cancelled_at remains null anyway.
  if exists (
    select 1
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'bookings'
      and a.attname = 'financial_resolution_state'
      and a.attnum > 0 and not a.attisdropped
  ) then
    execute $legacy$
      update public.bookings
      set financial_resolution_state = 'resolved',
          financial_resolution_next_attempt_at = null,
          financial_resolution_last_error = null,
          financial_resolved_at = $2,
          financial_resolution_lease_token = null,
          financial_resolution_lease_until = null
      where id = $1
    $legacy$ using v_booking.id, p_now;
  end if;

  update public.booking_money_operations
  set state = 'committed', stripe_refund_id = p_refund_id,
      provider_status = coalesce(p_provider_status, p_payment_intent_status, 'not_required'),
      provider_paid_cents = p_paid_cents,
      completed_at = p_now, lease_token = null, lease_until = null,
      last_error = null, updated_at = p_now
  where id = v_operation.id;
  return true;
end;
$$;

create or replace function public.complete_refund_decision(
  p_operation_id uuid,
  p_lease_token uuid,
  p_refund_id text,
  p_reversal_id text,
  p_provider_status text,
  p_refunded_cents integer,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.booking_money_operations%rowtype;
  v_booking public.bookings%rowtype;
begin
  select * into v_operation from public.booking_money_operations
  where id = p_operation_id and lease_token = p_lease_token
    and kind = 'refund_request' and state in ('claimed', 'provider_pending') for update;
  if not found then return false; end if;
  select * into v_booking from public.bookings where id = v_operation.booking_id for update;

  if p_provider_status in ('pending', 'requires_action') then
    update public.booking_money_operations
    set state = 'provider_pending', stripe_refund_id = p_refund_id,
        stripe_reversal_id = p_reversal_id, provider_status = p_provider_status,
        next_attempt_at = p_now + interval '5 minutes',
        lease_token = null, lease_until = null, updated_at = p_now
    where id = v_operation.id;
    return false;
  end if;

  if v_booking.active_money_operation_id <> v_operation.id
    or coalesce(v_booking.refunded_cents, 0) <> v_operation.refunded_before_cents
    or p_provider_status <> 'succeeded'
    or p_refund_id is null
    or p_refunded_cents <> v_operation.expected_refund_cents
    or (v_operation.expected_reversal_cents > 0 and p_reversal_id is null)
  then
    update public.booking_money_operations
    set state = 'manual_review', stripe_refund_id = p_refund_id,
        stripe_reversal_id = p_reversal_id, provider_status = p_provider_status,
        last_error = 'Provider result did not match the claimed refund decision',
        lease_token = null, lease_until = null, updated_at = p_now
    where id = v_operation.id;
    perform public.project_booking_money_manual_review(
      v_booking.id,
      'Provider result did not match the claimed refund decision'
    );
    return false;
  end if;

  update public.bookings
  set refunded_at = p_now,
      refunded_cents = v_operation.refunded_before_cents + v_operation.expected_refund_cents,
      active_money_operation_id = null
  where id = v_booking.id;

  update public.refund_requests
  set state = 'approved', outcome = v_operation.requested_outcome,
      decided_by = v_operation.decision_actor_id, decided_at = p_now,
      decision_note = v_operation.decision_note,
      refunded_cents = v_operation.expected_refund_cents
  where id = v_operation.refund_request_id
    and state in ('awaiting_host', 'awaiting_staff');

  if not found then
    update public.booking_money_operations
    set state = 'manual_review', last_error = 'Refund request changed before completion',
        stripe_refund_id = p_refund_id, stripe_reversal_id = p_reversal_id,
        provider_status = p_provider_status, lease_token = null, lease_until = null,
        updated_at = p_now
    where id = v_operation.id;
    -- Keep the booking locked against another operation: rolling its refund
    -- ledger back after Stripe succeeded would be a lie, so manual review owns it.
    update public.bookings set active_money_operation_id = v_operation.id
    where id = v_booking.id;
    perform public.project_booking_money_manual_review(
      v_booking.id,
      'Refund request changed after Stripe refund succeeded'
    );
    return false;
  end if;

  update public.booking_money_operations
  set state = 'committed', stripe_refund_id = p_refund_id,
      stripe_reversal_id = p_reversal_id, provider_status = p_provider_status,
      completed_at = p_now, lease_token = null, lease_until = null,
      last_error = null, updated_at = p_now
  where id = v_operation.id;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Existing ambiguous rows: never blindly replay an old refund after Stripe's
-- idempotency retention window.  Preserve the intended outcome in a permanent
-- manual-review operation and make the request non-final until it is reconciled.
-- ---------------------------------------------------------------------------

insert into public.booking_money_operations (
  booking_id, refund_request_id, kind, state, operation_key,
  requested_outcome, decision_actor_id, decision_note, provider_action,
  space_id, practitioner_id, payment_intent_id, source_transfer_id,
  host_rate_cents, service_fee_cents, instant_fee_cents, pro_discount_cents,
  total_cents, platform_cents,
  refunded_before_cents, expected_refund_cents, expected_reversal_cents,
  last_error, created_at, updated_at
)
select
  b.id, r.id, 'refund_request', 'manual_review',
  'refund_request:' || r.id::text, r.outcome, r.decided_by, r.decision_note,
  case when r.outcome = 'full' and b.host_paid_at is not null
    then 'reverse_and_refund' else 'refund' end,
  b.space_id, b.practitioner_id, b.stripe_payment_intent_id, b.stripe_transfer_id,
  b.host_rate_cents, b.service_fee_cents, b.instant_fee_cents,
  b.pro_discount_cents, b.total_cents, b.platform_cents,
  coalesce(b.refunded_cents, 0),
  case r.outcome when 'full' then b.total_cents
    when 'our_fee' then b.total_cents - b.host_rate_cents else 0 end,
  case when r.outcome = 'full' and b.host_paid_at is not null then b.host_rate_cents else 0 end,
  'Legacy approved refund has no durable paid amount; reconcile provider state manually',
  coalesce(r.decided_at, r.created_at), now()
from public.refund_requests r
join public.bookings b on b.id = r.booking_id
where r.state = 'approved'
  and r.outcome in ('full', 'our_fee')
  and r.refunded_cents is null
on conflict (refund_request_id) do nothing;

update public.bookings b
set active_money_operation_id = o.id
from public.booking_money_operations o
where o.booking_id = b.id
  and o.state = 'manual_review'
  and b.active_money_operation_id is null;

update public.refund_requests r
set state = 'awaiting_staff', outcome = null, decided_by = null,
    decided_at = null, decision_note = null
where r.state = 'approved'
  and r.refunded_cents is null
  and exists (
    select 1 from public.booking_money_operations o
    where o.refund_request_id = r.id and o.state = 'manual_review'
  );

-- A worker can die after the provider receipt and decision commit but before
-- the outbox claim.  Return only committed decisions with a genuinely missing
-- expected recipient channel, so either cron cadence repairs that crash gap.
create or replace function public.list_refund_decision_notification_gaps(
  p_since timestamptz,
  p_limit integer default 100
)
returns table (id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 200 then
    raise exception 'p_limit must be between 1 and 200';
  end if;

  return query
  select r.id
  from public.booking_money_operations o
  join public.refund_requests r on r.id = o.refund_request_id
  join public.bookings b on b.id = o.booking_id
  join public.spaces s on s.id = b.space_id
  left join auth.users practitioner_user on practitioner_user.id = b.practitioner_id
  left join auth.users host_user on host_user.id = s.host_id
  where o.kind = 'refund_request'
    and o.state = 'committed'
    and o.completed_at >= p_since
    and r.state in ('approved', 'refused')
    and (
      (
        practitioner_user.email is not null
        and not exists (
          select 1 from public.notifications n
          where n.dedupe_key = 'refund_decided:' || r.id::text || ':email'
        )
      )
      or (
        r.outcome = 'full'
        and b.host_paid_at is not null
        and o.expected_reversal_cents > 0
        and o.stripe_reversal_id is not null
        and host_user.email is not null
        and not exists (
          select 1 from public.notifications n
          where n.dedupe_key = 'refund_taken_back:' || r.id::text || ':email'
        )
      )
    )
  order by o.completed_at, o.id
  limit p_limit;
end;
$$;

-- The lifecycle migration intentionally lands before the money journal.  Its
-- outbox worker therefore cannot know that a payout/refund receipt is true
-- only after the matching journal entry commits.  Centralize the final state
-- predicate here and use it both when stale rows are dropped and immediately
-- before a due row is leased.
create or replace function public.notification_delivery_is_current(
  p_kind text,
  p_booking_id uuid,
  p_dedupe_key text,
  p_channel text,
  p_now timestamptz,
  p_require_settled boolean default false
)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  return case
    when p_kind not in (
      'booking_confirmed', 'host_new_booking', 'request_approved',
      'host_new_request', 'request_submitted', 'host_request_reminder',
      'host_payout_sent', 'access_code_ready', 'new_message',
      'request_declined', 'request_expired',
      'cancelled_by_practitioner', 'cancelled_by_host',
      'refund_decided', 'refund_taken_back'
    ) then true
    when p_booking_id is null then false
    else coalesce((
      select case
        when p_kind in ('booking_confirmed', 'host_new_booking') then
          b.status = 'upcoming'
          and b.cancelled_at is null
          and b.financial_resolution_state in ('not_required', 'resolved')
          and b.active_money_operation_id is null
          and b.captured_at is not null
        when p_kind = 'request_approved' then
          b.status = 'upcoming'
          and b.cancelled_at is null
          and b.financial_resolution_state in ('not_required', 'resolved')
          and b.active_money_operation_id is null
          and b.approval_state = 'approved'
          and b.captured_at is not null
        when p_kind in (
          'host_new_request', 'request_submitted', 'host_request_reminder'
        ) then
          b.status = 'upcoming'
          and b.cancelled_at is null
          and b.financial_resolution_state = 'not_required'
          and b.active_money_operation_id is null
          and b.approval_state = 'pending'
          and b.authorized_at is not null
          and b.captured_at is null
        when p_kind = 'host_payout_sent' then
          b.host_paid_at is not null
          and b.stripe_transfer_id is not null
          and b.host_rate_refunded is false
          and b.financial_resolution_state in ('not_required', 'resolved')
          and b.active_money_operation_id is null
          and p_dedupe_key = 'host_payout_sent:' || b.id::text || ':' || p_channel
          and exists (
            select 1
            from public.booking_money_operations o
            where o.booking_id = b.id
              and o.kind = 'payout'
              and o.state = 'committed'
              and o.stripe_transfer_id = b.stripe_transfer_id
          )
        when p_kind = 'access_code_ready' then
          b.status = 'upcoming'
          and b.cancelled_at is null
          and b.financial_resolution_state in ('not_required', 'resolved')
          and b.active_money_operation_id is null
          and b.captured_at is not null
          and b.access_code is not null
          and b.access_code_revealed_at <= p_now
          and b.ends_at > p_now
        when p_kind = 'new_message' then
          b.status = 'upcoming'
          and b.cancelled_at is null
          and b.financial_resolution_state in ('not_required', 'resolved')
          and b.active_money_operation_id is null
          and b.ends_at > p_now
        when p_kind = 'request_declined' then
          b.approval_state = 'declined'
          and (
            not p_require_settled
            or (
              b.financial_resolution_state = 'resolved'
              and b.active_money_operation_id is null
            )
          )
        when p_kind = 'request_expired' then
          b.approval_state = 'expired'
          and (
            not p_require_settled
            or (
              b.financial_resolution_state = 'resolved'
              and b.active_money_operation_id is null
            )
          )
        when p_kind = 'cancelled_by_practitioner' then
          b.cancelled_by = 'practitioner'
          and (
            not p_require_settled
            or (
              b.financial_resolution_state = 'resolved'
              and b.active_money_operation_id is null
            )
          )
        when p_kind = 'cancelled_by_host' then
          b.cancelled_by = 'host'
          and (
            not p_require_settled
            or (
              b.financial_resolution_state = 'resolved'
              and b.active_money_operation_id is null
            )
          )
        when p_kind = 'refund_decided' then
          b.financial_resolution_state in ('not_required', 'resolved')
          and b.active_money_operation_id is null
          and exists (
            select 1
            from public.refund_requests r
            join public.booking_money_operations o
              on o.refund_request_id = r.id
            where r.booking_id = b.id
              and r.state in ('approved', 'refused')
              and o.kind = 'refund_request'
              and o.state = 'committed'
              and p_dedupe_key = 'refund_decided:' || r.id::text || ':' || p_channel
          )
        when p_kind = 'refund_taken_back' then
          b.host_paid_at is not null
          and b.financial_resolution_state in ('not_required', 'resolved')
          and b.active_money_operation_id is null
          and exists (
            select 1
            from public.refund_requests r
            join public.booking_money_operations o
              on o.refund_request_id = r.id
            where r.booking_id = b.id
              and r.state = 'approved'
              and r.outcome = 'full'
              and o.kind = 'refund_request'
              and o.state = 'committed'
              and o.expected_reversal_cents > 0
              and o.stripe_reversal_id is not null
              and p_dedupe_key = 'refund_taken_back:' || r.id::text || ':' || p_channel
          )
        else false
      end
      from public.bookings b
      where b.id = p_booking_id
    ), false)
  end;
end;
$$;

revoke all on function public.notification_delivery_is_current(
  text, uuid, text, text, timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.notification_delivery_is_current(
  text, uuid, text, text, timestamptz, boolean
) to service_role;

create or replace function public.claim_notification_batch(
  p_worker uuid,
  p_limit integer default 50,
  p_now timestamptz default now()
)
returns table (
  id uuid,
  kind text,
  channel public.notification_channel,
  dedupe_key text,
  destination text,
  message_snapshot jsonb,
  provider_correlation_id text,
  attempts integer,
  booking_id uuid,
  expires_at timestamptz,
  lease_token uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_worker is null then
    raise exception 'p_worker is required';
  end if;
  if p_limit < 1 or p_limit > 200 then
    raise exception 'p_limit must be between 1 and 200';
  end if;

  update public.notifications n
  set dropped_at = p_now,
      failed_at = p_now,
      provider_status = 'failed',
      last_error = 'notification expired',
      destination = null,
      message_snapshot = null,
      lease_token = null,
      lease_until = null
  where n.sent_at is null
    and n.dropped_at is null
    and (n.lease_until is null or n.lease_until <= p_now)
    and n.expires_at is not null
    and n.expires_at <= p_now;

  update public.notifications n
  set dropped_at = p_now,
      failed_at = p_now,
      provider_status = 'failed',
      last_error = 'notification retry attempts exhausted',
      destination = null,
      message_snapshot = null,
      lease_token = null,
      lease_until = null
  where n.sent_at is null
    and n.dropped_at is null
    and n.attempts >= 12
    and (n.lease_until is null or n.lease_until <= p_now);

  update public.notifications n
  set dropped_at = p_now,
      failed_at = p_now,
      provider_status = 'failed',
      last_error = 'notification superseded by current booking state',
      destination = null,
      message_snapshot = null,
      lease_token = null,
      lease_until = null
  where n.sent_at is null
    and n.dropped_at is null
    and (n.lease_until is null or n.lease_until <= p_now)
    and not public.notification_delivery_is_current(
      n.kind,
      n.booking_id,
      n.dedupe_key,
      n.channel::text,
      p_now,
      false
    );

  return query
  with due as (
    select n.id
    from public.notifications n
    where n.sent_at is null
      and n.dropped_at is null
      and n.destination is not null
      and n.message_snapshot is not null
      and n.attempts < 12
      and n.next_attempt_at <= p_now
      and (n.expires_at is null or n.expires_at > p_now)
      and (n.lease_until is null or n.lease_until <= p_now)
      and public.notification_delivery_is_current(
        n.kind,
        n.booking_id,
        n.dedupe_key,
        n.channel::text,
        p_now,
        true
      )
    order by n.next_attempt_at, n.created_at
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.notifications n
    set lease_token = p_worker,
        lease_until = p_now + interval '15 minutes',
        attempts = n.attempts + 1
    from due
    where n.id = due.id
    returning n.id, n.kind, n.channel, n.dedupe_key, n.destination,
      n.message_snapshot, n.provider_correlation_id, n.attempts,
      n.booking_id, n.expires_at, n.lease_token
  )
  select c.id, c.kind, c.channel, c.dedupe_key, c.destination,
    c.message_snapshot, c.provider_correlation_id, c.attempts,
    c.booking_id, c.expires_at, c.lease_token
  from claimed c;
end;
$$;

revoke all on function public.claim_notification_batch(uuid, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_notification_batch(uuid, integer, timestamptz)
  to service_role;

create or replace function public.list_request_submission_notification_gaps(
  p_since timestamptz,
  p_now timestamptz default now(),
  p_limit integer default 100
)
returns table (id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 200 then
    raise exception 'p_limit must be between 1 and 200';
  end if;

  return query
  select b.id
  from public.bookings b
  join public.spaces s on s.id = b.space_id
  left join auth.users practitioner_user on practitioner_user.id = b.practitioner_id
  left join auth.users host_user on host_user.id = s.host_id
  where b.authorized_at >= p_since
    and b.status = 'upcoming'
    and b.cancelled_at is null
    and b.financial_resolution_state = 'not_required'
    and b.active_money_operation_id is null
    and b.approval_state = 'pending'
    and b.captured_at is null
    and b.starts_at > p_now
    and (
      (
        practitioner_user.email is not null
        and not exists (
          select 1 from public.notifications n
          where n.dedupe_key = 'request_submitted:' || b.id::text || ':email'
        )
      )
      or (
        host_user.email is not null
        and not exists (
          select 1 from public.notifications n
          where n.dedupe_key = 'host_new_request:' || b.id::text || ':email'
        )
      )
    )
  order by b.authorized_at, b.id
  limit p_limit;
end;
$$;

create or replace function public.list_host_payout_notification_gaps(
  p_since timestamptz,
  p_limit integer default 100
)
returns table (id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 200 then
    raise exception 'p_limit must be between 1 and 200';
  end if;

  return query
  select b.id
  from public.bookings b
  join public.spaces s on s.id = b.space_id
  join public.profiles host_profile on host_profile.id = s.host_id
  join auth.users host_user on host_user.id = s.host_id
  where b.host_paid_at >= p_since
    and b.stripe_transfer_id is not null
    and b.host_rate_refunded is false
    and b.financial_resolution_state in ('not_required', 'resolved')
    and b.active_money_operation_id is null
    and host_profile.notify_payouts is true
    and host_user.email is not null
    and exists (
      select 1
      from public.booking_money_operations o
      where o.booking_id = b.id
        and o.kind = 'payout'
        and o.state = 'committed'
        and o.stripe_transfer_id = b.stripe_transfer_id
    )
    and not exists (
      select 1 from public.notifications n
      where n.dedupe_key = 'host_payout_sent:' || b.id::text || ':email'
    )
  order by b.host_paid_at, b.id
  limit p_limit;
end;
$$;

revoke all on function public.list_request_submission_notification_gaps(
  timestamptz, timestamptz, integer
) from public, anon, authenticated;
grant execute on function public.list_request_submission_notification_gaps(
  timestamptz, timestamptz, integer
) to service_role;

revoke all on function public.list_host_payout_notification_gaps(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.list_host_payout_notification_gaps(timestamptz, integer)
  to service_role;

-- RPCs are reachable only by the server key.  SECURITY DEFINER supplies the
-- row locks; explicit ACLs stop a browser from claiming or completing money.
revoke all on function public.claim_booking_payout(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_booking_payout(uuid, uuid, timestamptz)
  to service_role;

revoke all on function public.claim_booking_cancellation(
  uuid, public.cancelled_by_actor, uuid, text, integer, integer, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.claim_booking_cancellation(
  uuid, public.cancelled_by_actor, uuid, text, integer, integer, uuid, timestamptz
) to service_role;

revoke all on function public.claim_refund_decision(
  uuid, uuid, public.refund_outcome, text, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.claim_refund_decision(
  uuid, uuid, public.refund_outcome, text, uuid, timestamptz
) to service_role;

revoke all on function public.claim_booking_money_operation_retries(uuid, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_booking_money_operation_retries(uuid, integer, timestamptz)
  to service_role;

revoke all on function public.fail_booking_money_operation(uuid, uuid, text, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.fail_booking_money_operation(uuid, uuid, text, boolean, timestamptz)
  to service_role;

revoke all on function public.complete_booking_payout(uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.complete_booking_payout(uuid, uuid, text, timestamptz)
  to service_role;

revoke all on function public.complete_booking_cancellation(
  uuid, uuid, text, text, text, integer, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.complete_booking_cancellation(
  uuid, uuid, text, text, text, integer, integer, timestamptz
) to service_role;

revoke all on function public.complete_refund_decision(
  uuid, uuid, text, text, text, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.complete_refund_decision(
  uuid, uuid, text, text, text, integer, timestamptz
) to service_role;

revoke all on function public.list_refund_decision_notification_gaps(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.list_refund_decision_notification_gaps(timestamptz, integer)
  to service_role;
