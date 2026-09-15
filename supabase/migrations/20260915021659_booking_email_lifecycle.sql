-- Two lifecycle receipts were missing from the transactional outbox:
-- a practitioner did not hear that a request was backed by a real card hold,
-- and a host did not hear that session earnings reached Stripe balance.
-- Both are reconstructed from durable booking state so process crashes are
-- recoverable and provider retries remain deduped.

create index if not exists bookings_authorized_request_notification_gap_idx
  on public.bookings (authorized_at, id)
  where approval_state = 'pending'
    and status = 'upcoming'
    and authorized_at is not null;

create index if not exists bookings_host_payout_notification_gap_idx
  on public.bookings (host_paid_at, id)
  where host_paid_at is not null and stripe_transfer_id is not null;

-- Keep immutable queued messages honest at retry time. A request receipt is
-- valid only while the Stripe-backed request is still pending; a payout
-- receipt is valid only after both halves of the durable transfer marker exist.
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
    and n.lease_until is not null
    and n.lease_until <= p_now;

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
    and n.kind in (
      'booking_confirmed', 'host_new_booking', 'request_approved',
      'host_new_request', 'request_submitted', 'host_request_reminder',
      'host_payout_sent', 'access_code_ready', 'new_message',
      'request_declined', 'request_expired',
      'cancelled_by_practitioner', 'cancelled_by_host'
    )
    and (
      n.booking_id is null
      or not exists (
        select 1
        from public.bookings b
        where b.id = n.booking_id
          and case
            when n.kind in ('booking_confirmed', 'host_new_booking') then
              b.status = 'upcoming' and b.captured_at is not null
            when n.kind = 'request_approved' then
              b.status = 'upcoming'
              and b.approval_state = 'approved'
              and b.captured_at is not null
            when n.kind in ('host_new_request', 'host_request_reminder') then
              b.status = 'upcoming'
              and b.approval_state = 'pending'
              and b.authorized_at is not null
              and b.captured_at is null
            when n.kind = 'request_submitted' then
              b.status = 'upcoming'
              and b.approval_state = 'pending'
              and b.authorized_at is not null
              and b.captured_at is null
            when n.kind = 'host_payout_sent' then
              b.host_paid_at is not null
              and b.stripe_transfer_id is not null
            when n.kind = 'access_code_ready' then
              b.status = 'upcoming'
              and b.captured_at is not null
              and b.access_code is not null
              and b.access_code_revealed_at <= p_now
              and b.ends_at > p_now
            when n.kind = 'new_message' then
              b.status = 'upcoming' and b.ends_at > p_now
            when n.kind = 'request_declined' then
              b.approval_state = 'declined'
            when n.kind = 'request_expired' then
              b.approval_state = 'expired'
            when n.kind = 'cancelled_by_practitioner' then
              b.cancelled_by = 'practitioner'
            when n.kind = 'cancelled_by_host' then
              b.cancelled_by = 'host'
            else false
          end
      )
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

-- A crash can happen after authorized_at is written and before either email
-- claim. Return a booking when at least one recipient's expected email row is
-- absent; calling both notifiers is safe because each has its own dedupe key.
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
  order by b.authorized_at asc, b.id asc
  limit p_limit;
end;
$$;

revoke all on function public.list_request_submission_notification_gaps(
  timestamptz, timestamptz, integer
) from public, anon, authenticated;
grant execute on function public.list_request_submission_notification_gaps(
  timestamptz, timestamptz, integer
) to service_role;

-- Only hosts who asked for payout alerts and have an email are eligible. The
-- transfer id and paid timestamp are an inseparable durable receipt (0030),
-- never an inference from the cron having attempted a Stripe request.
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
    and host_profile.notify_payouts is true
    and host_user.email is not null
    and not exists (
      select 1 from public.notifications n
      where n.dedupe_key = 'host_payout_sent:' || b.id::text || ':email'
    )
  order by b.host_paid_at asc, b.id asc
  limit p_limit;
end;
$$;

revoke all on function public.list_host_payout_notification_gaps(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.list_host_payout_notification_gaps(timestamptz, integer)
  to service_role;
