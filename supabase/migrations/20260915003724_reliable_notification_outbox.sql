-- A durable, private delivery envelope for every notification.
--
-- The original queue remembered only the kind and tried to recreate the
-- message from whatever the booking looked like later. That is unsafe for
-- money, refunds and staff alerts: a retry can truthfully describe only the
-- immutable message that was accepted for delivery. The envelope below is
-- server-only; the existing my_notifications view continues to expose only a
-- safe status summary to the recipient.

-- Cancellation and request rejection both move money at Stripe. Persist that
-- work on the booking before calling Stripe so a process crash can be retried
-- without either changing the recorded actor or sending a receipt that claims
-- money was released before it really was. Existing actor cancellations were
-- written only after their Stripe settlement completed; legacy declined or
-- expired requests with a PaymentIntent are deliberately retried because the
-- old path could swallow a failed hold release.
alter table public.bookings
  add column if not exists financial_resolution_state text
    not null default 'not_required',
  add column if not exists financial_resolution_attempts integer
    not null default 0,
  add column if not exists financial_resolution_next_attempt_at timestamptz,
  add column if not exists financial_resolution_last_error text,
  add column if not exists financial_resolved_at timestamptz,
  add column if not exists financial_resolution_lease_token uuid,
  add column if not exists financial_resolution_lease_until timestamptz;

do $$
begin
  alter table public.bookings
    add constraint bookings_financial_resolution_state_valid
    check (financial_resolution_state in (
      'not_required', 'pending', 'resolved', 'manual_review'
    ));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.bookings
    add constraint bookings_financial_resolution_attempts_nonnegative
    check (financial_resolution_attempts >= 0);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.bookings
    add constraint bookings_financial_resolution_lease_consistent
    check (
      (financial_resolution_lease_token is null) =
      (financial_resolution_lease_until is null)
    );
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.bookings
    add constraint bookings_financial_resolution_fields_consistent
    check (
      (
        financial_resolution_state = 'pending'
        and financial_resolution_next_attempt_at is not null
        and financial_resolved_at is null
      )
      or (
        financial_resolution_state = 'resolved'
        and financial_resolution_next_attempt_at is null
        and financial_resolved_at is not null
        and financial_resolution_lease_token is null
        and financial_resolution_lease_until is null
      )
      or (
        financial_resolution_state in ('not_required', 'manual_review')
        and financial_resolution_next_attempt_at is null
        and financial_resolved_at is null
        and financial_resolution_lease_token is null
        and financial_resolution_lease_until is null
      )
    );
exception when duplicate_object then null;
end $$;

-- A durable cancellation/request decision may keep the slot in its active
-- status while Stripe work is outstanding. An actor cancellation already
-- satisfies the original timestamp/actor pairing; declined and expired
-- requests deliberately have no actor, so admit that shape while it is
-- pending (or held for manual review) and require the terminal status once
-- provider work is resolved.
alter table public.bookings
  drop constraint if exists bookings_cancellation_consistent;

alter table public.bookings
  add constraint bookings_cancellation_consistent check (
    ((cancelled_at is null) = (cancelled_by is null))
    or (
      approval_state in ('declined', 'expired')
      and cancelled_at is not null
      and cancelled_by is null
      and (
        status = 'cancelled_by_host'
        or (
          status = 'upcoming'
          and financial_resolution_state in ('pending', 'manual_review')
        )
      )
    )
  );

update public.bookings
set financial_resolution_state = 'resolved',
    financial_resolution_next_attempt_at = null,
    financial_resolution_last_error = null,
    financial_resolved_at = coalesce(cancelled_at, now()),
    financial_resolution_lease_token = null,
    financial_resolution_lease_until = null
where financial_resolution_state = 'not_required'
  and cancelled_by is not null;

update public.bookings
set status = case
      when stripe_payment_intent_id is null
        then 'cancelled_by_host'::public.booking_status
      else 'upcoming'::public.booking_status
    end,
    cancelled_at = coalesce(cancelled_at, approval_decided_at, now()),
    cancelled_by = null,
    financial_resolution_state = case
      when stripe_payment_intent_id is null then 'resolved'
      else 'pending'
    end,
    financial_resolution_next_attempt_at = case
      when stripe_payment_intent_id is null then null
      else now()
    end,
    financial_resolution_last_error = null,
    financial_resolved_at = case
      when stripe_payment_intent_id is null
        then coalesce(approval_decided_at, cancelled_at, now())
      else null
    end,
    financial_resolution_lease_token = null,
    financial_resolution_lease_until = null
where financial_resolution_state = 'not_required'
  and cancelled_by is null
  and approval_state in ('declined', 'expired');

create index if not exists bookings_financial_resolution_ready_idx
  on public.bookings (financial_resolution_next_attempt_at, created_at)
  where financial_resolution_state = 'pending';

-- A Stripe worker leases each financial decision for fifteen minutes. After
-- twelve failed or abandoned attempts the booking is retained for explicit
-- manual review; it is never silently treated as settled.
create or replace function public.claim_booking_financial_resolution_batch(
  p_worker uuid,
  p_limit integer default 50,
  p_now timestamptz default now()
)
returns table (
  id uuid,
  stripe_payment_intent_id text,
  approval_state text,
  cancelled_by public.cancelled_by_actor,
  cancelled_at timestamptz,
  starts_at timestamptz,
  captured_at timestamptz,
  was_pro boolean,
  host_rate_cents integer,
  service_fee_cents integer,
  instant_fee_cents integer,
  pro_discount_cents integer,
  credit_applied_cents integer,
  total_cents integer,
  platform_cents integer,
  attempts integer,
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

  update public.bookings b
  set financial_resolution_state = 'manual_review',
      financial_resolution_next_attempt_at = null,
      financial_resolution_last_error = coalesce(
        b.financial_resolution_last_error,
        'financial resolution retry attempts exhausted'
      ),
      financial_resolution_lease_token = null,
      financial_resolution_lease_until = null
  where b.financial_resolution_state = 'pending'
    and b.financial_resolution_attempts >= 12
    and (
      b.financial_resolution_lease_until is null
      or b.financial_resolution_lease_until <= p_now
    );

  return query
  with due as (
    select b.id
    from public.bookings b
    where b.financial_resolution_state = 'pending'
      and b.financial_resolution_attempts < 12
      and b.financial_resolution_next_attempt_at <= p_now
      and (
        b.financial_resolution_lease_until is null
        or b.financial_resolution_lease_until <= p_now
      )
    order by b.financial_resolution_next_attempt_at, b.created_at, b.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.bookings b
    set financial_resolution_lease_token = p_worker,
        financial_resolution_lease_until = p_now + interval '15 minutes',
        financial_resolution_attempts = b.financial_resolution_attempts + 1
    from due
    where b.id = due.id
    returning b.id, b.stripe_payment_intent_id, b.approval_state,
      b.cancelled_by, b.cancelled_at, b.starts_at, b.captured_at, b.was_pro,
      b.host_rate_cents, b.service_fee_cents, b.instant_fee_cents,
      b.pro_discount_cents, b.credit_applied_cents, b.total_cents,
      b.platform_cents, b.financial_resolution_attempts,
      b.financial_resolution_lease_token
  )
  select c.id, c.stripe_payment_intent_id, c.approval_state,
    c.cancelled_by, c.cancelled_at, c.starts_at, c.captured_at, c.was_pro,
    c.host_rate_cents, c.service_fee_cents, c.instant_fee_cents,
    c.pro_discount_cents, c.credit_applied_cents, c.total_cents,
    c.platform_cents, c.financial_resolution_attempts,
    c.financial_resolution_lease_token
  from claimed c;
end;
$$;

revoke all on function public.claim_booking_financial_resolution_batch(
  uuid, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.claim_booking_financial_resolution_batch(
  uuid, integer, timestamptz
) to service_role;

alter table public.notifications
  alter column user_id drop not null,
  add column if not exists destination text,
  add column if not exists message_snapshot jsonb,
  add column if not exists provider_message_id text,
  add column if not exists provider_correlation_id text,
  add column if not exists provider_status text not null default 'queued',
  add column if not exists provider_event_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists expires_at timestamptz,
  add column if not exists lease_token uuid,
  add column if not exists lease_until timestamptz;

-- Rows created before this migration used sent_at to mean "the provider
-- accepted it". Preserve that meaning while giving new code an explicit name.
update public.notifications
set accepted_at = coalesce(accepted_at, sent_at),
    provider_status = case
      when dropped_at is not null then 'failed'
      when sent_at is not null then 'accepted'
      else 'queued'
    end
where accepted_at is null or provider_status = 'queued';

do $$
begin
  alter table public.notifications
    add constraint notifications_has_recipient
    check (
      user_id is not null
      or destination is not null
      or sent_at is not null
      or dropped_at is not null
    );
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.notifications
    add constraint notifications_destination_bounded
    check (destination is null or length(destination) between 3 and 320);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.notifications
    add constraint notifications_snapshot_is_object
    check (message_snapshot is null or jsonb_typeof(message_snapshot) = 'object');
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.notifications
    add constraint notifications_provider_status_valid
    check (provider_status in (
      'queued', 'accepted', 'delayed', 'delivered',
      'failed', 'bounced', 'complained', 'suppressed'
    ));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.notifications
    add constraint notifications_provider_correlation_valid
    check (
      provider_correlation_id is null
      or provider_correlation_id ~ '^[a-f0-9]{64}$'
    );
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.notifications
    add constraint notifications_attempts_nonnegative check (attempts >= 0);
exception when duplicate_object then null;
end $$;

create unique index if not exists notifications_provider_message_id_uidx
  on public.notifications (provider_message_id)
  where provider_message_id is not null and provider_message_id <> 'unknown';

create unique index if not exists notifications_provider_correlation_id_uidx
  on public.notifications (provider_correlation_id)
  where provider_correlation_id is not null;

create index if not exists notifications_retry_ready_idx
  on public.notifications (next_attempt_at, created_at)
  where sent_at is null and dropped_at is null;

create index if not exists notifications_cancel_reconcile_idx
  on public.notifications (booking_id, kind, channel)
  where booking_id is not null;

-- A retry worker owns a row for fifteen minutes. FOR UPDATE SKIP LOCKED makes
-- overlapping Vercel invocations harmless: each row is returned to at most one
-- worker, while an abandoned lease becomes available again automatically.
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

  -- A worker can die after taking its final lease. Once that lease expires,
  -- make the row terminal so private destination/body data cannot be retained
  -- forever in an unclaimable state.
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

  -- Immutable copy does not mean immutable eligibility. A confirmation,
  -- request nudge or door code that has been superseded by a cancellation or
  -- decision must become terminal instead of being delivered late.
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
      'host_new_request', 'host_request_reminder', 'access_code_ready',
      'new_message', 'request_declined', 'request_expired',
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
              b.status = 'upcoming'
              and b.cancelled_at is null
              and b.financial_resolution_state in ('not_required', 'resolved')
              and b.captured_at is not null
            when n.kind = 'request_approved' then
              b.status = 'upcoming'
              and b.cancelled_at is null
              and b.financial_resolution_state in ('not_required', 'resolved')
              and b.approval_state = 'approved'
              and b.captured_at is not null
            when n.kind in ('host_new_request', 'host_request_reminder') then
              b.status = 'upcoming'
              and b.cancelled_at is null
              and b.financial_resolution_state = 'not_required'
              and b.approval_state = 'pending'
              and b.authorized_at is not null
            when n.kind = 'access_code_ready' then
              b.status = 'upcoming'
              and b.cancelled_at is null
              and b.financial_resolution_state in ('not_required', 'resolved')
              and b.captured_at is not null
              and b.access_code is not null
              and b.access_code_revealed_at <= p_now
              and b.ends_at > p_now
            when n.kind = 'new_message' then
              b.status = 'upcoming'
              and b.cancelled_at is null
              and b.financial_resolution_state in ('not_required', 'resolved')
              and b.ends_at > p_now
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
      and (
        n.kind not in (
          'request_declined', 'request_expired',
          'cancelled_by_practitioner', 'cancelled_by_host'
        )
        or exists (
          select 1
          from public.bookings b
          where b.id = n.booking_id
            and b.financial_resolution_state = 'resolved'
        )
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
      n.booking_id, n.expires_at,
      n.lease_token
  )
  select c.id, c.kind, c.channel, c.dedupe_key, c.destination,
    c.message_snapshot, c.provider_correlation_id, c.attempts,
    c.booking_id, c.expires_at,
    c.lease_token
  from claimed c;
end;
$$;

revoke all on function public.claim_notification_batch(uuid, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_notification_batch(uuid, integer, timestamptz)
  to service_role;

-- Resend can also report temporary delay and provider suppression. They are
-- delivery facts, just like delivered/bounced, and must be retained so a
-- delayed message does not appear healthy. Accepted rows never re-enter this
-- outbox; Resend remains authoritative for address-level suppression.
alter table public.resend_email_events
  drop constraint if exists resend_email_events_event_type_check;

alter table public.resend_email_events
  add constraint resend_email_events_event_type_check check (
    event_type in (
      'email.delivered',
      'email.delivery_delayed',
      'email.failed',
      'email.bounced',
      'email.complained',
      'email.suppressed'
    )
  );

alter table public.resend_email_events
  add column if not exists notification_correlation_id text;

do $$
begin
  alter table public.resend_email_events
    add constraint resend_email_events_notification_correlation_valid
    check (
      notification_correlation_id is null
      or notification_correlation_id ~ '^[a-f0-9]{64}$'
    );
exception when duplicate_object then null;
end $$;

create index if not exists resend_email_events_correlation_created_idx
  on public.resend_email_events (
    notification_correlation_id, event_created_at desc, received_at desc
  )
  where notification_correlation_id is not null;

-- Reduce an authenticated provider event onto its notification without ever
-- letting an old or weaker event overwrite a newer terminal result. This is
-- SECURITY INVOKER: the server's service role already holds the narrow table
-- grant it needs. The function is explicitly closed to browser roles below.
drop function if exists public.apply_resend_delivery_event(text, text, timestamptz);

create or replace function public.apply_resend_delivery_event(
  p_resend_email_id text,
  p_notification_correlation_id text,
  p_event_type text,
  p_event_created_at timestamptz
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected integer := 0;
  next_status text;
  next_rank integer;
begin
  next_status := case p_event_type
    when 'email.delivered' then 'delivered'
    when 'email.delivery_delayed' then 'delayed'
    when 'email.failed' then 'failed'
    when 'email.bounced' then 'bounced'
    when 'email.complained' then 'complained'
    when 'email.suppressed' then 'suppressed'
    else null
  end;

  if next_status is null then
    return 0;
  end if;

  next_rank := case next_status
    when 'accepted' then 1
    when 'delayed' then 2
    when 'delivered' then 3
    when 'failed' then 4
    when 'bounced' then 5
    when 'suppressed' then 6
    when 'complained' then 7
    else 0
  end;

  update public.notifications
  set provider_message_id = coalesce(provider_message_id, p_resend_email_id),
      provider_status = next_status,
      provider_event_at = p_event_created_at,
      accepted_at = coalesce(accepted_at, p_event_created_at),
      sent_at = coalesce(sent_at, p_event_created_at),
      last_error = case
        when next_status = 'delivered' then null
        when next_status in ('failed', 'bounced', 'complained', 'suppressed')
          then 'provider event: ' || p_event_type
        else last_error
      end,
      delivered_at = case
        when next_status = 'delivered' then p_event_created_at
        else delivered_at
      end,
      failed_at = case
        when next_status in ('failed', 'bounced', 'complained', 'suppressed')
          then p_event_created_at
        when next_status in ('delayed', 'delivered') then null
        else failed_at
      end,
      dropped_at = case
        when next_status in ('delayed', 'delivered') then null
        else dropped_at
      end,
      destination = null,
      message_snapshot = null,
      lease_token = null,
      lease_until = null
  where (
      provider_message_id = p_resend_email_id
      or (
        p_notification_correlation_id is not null
        and provider_correlation_id = p_notification_correlation_id
      )
    )
    and (
      -- A local expiry/exhaustion has no provider_event_at. The first signed
      -- provider fact is authoritative even when its status rank is lower.
      provider_event_at is null
      or next_rank > case provider_status
        when 'accepted' then 1
        when 'delayed' then 2
        when 'delivered' then 3
        when 'failed' then 4
        when 'bounced' then 5
        when 'suppressed' then 6
        when 'complained' then 7
        else 0
      end
      or (
        next_rank = case provider_status
          when 'accepted' then 1
          when 'delayed' then 2
          when 'delivered' then 3
          when 'failed' then 4
          when 'bounced' then 5
          when 'suppressed' then 6
          when 'complained' then 7
          else 0
        end
        and (provider_event_at is null or p_event_created_at > provider_event_at)
      )
    );

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.apply_resend_delivery_event(text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_resend_delivery_event(text, text, text, timestamptz)
  to service_role;

-- Persist provider acceptance and then reconcile an event that may have raced
-- ahead of this write. Calling this again with the same dedupe/provider pair is
-- intentionally safe, which closes the timeout-after-send gap together with
-- Resend's idempotency key.
create or replace function public.record_notification_acceptance(
  p_dedupe_key text,
  p_provider_message_id text,
  p_accepted_at timestamptz,
  p_lease_token uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  latest_event record;
  changed integer;
  notification_correlation text;
begin
  update public.notifications
  set provider_message_id = nullif(p_provider_message_id, 'unknown'),
      provider_status = 'accepted',
      accepted_at = coalesce(accepted_at, p_accepted_at),
      sent_at = coalesce(sent_at, p_accepted_at),
      destination = null,
      message_snapshot = null,
      last_error = null,
      lease_token = null,
      lease_until = null
  where dedupe_key = p_dedupe_key
    and lease_token = p_lease_token
    and sent_at is null
    and dropped_at is null;

  get diagnostics changed = row_count;
  if changed = 0 then return false; end if;

  select n.provider_correlation_id
    into notification_correlation
  from public.notifications n
  where n.dedupe_key = p_dedupe_key;

  if (
    (p_provider_message_id is not null and p_provider_message_id <> 'unknown')
    or notification_correlation is not null
  ) then
    select e.event_type, e.event_created_at
      into latest_event
    from public.resend_email_events e
    where (
        p_provider_message_id is not null
        and p_provider_message_id <> 'unknown'
        and e.resend_email_id = p_provider_message_id
      )
      or (
        notification_correlation is not null
        and e.notification_correlation_id = notification_correlation
      )
    order by case e.event_type
      when 'email.complained' then 7
      when 'email.suppressed' then 6
      when 'email.bounced' then 5
      when 'email.failed' then 4
      when 'email.delivered' then 3
      when 'email.delivery_delayed' then 2
      else 0
    end desc, e.event_created_at desc, e.received_at desc
    limit 1;

    if found then
      perform public.apply_resend_delivery_event(
        p_provider_message_id,
        notification_correlation,
        latest_event.event_type,
        latest_event.event_created_at
      );
    end if;
  end if;

  return true;
end;
$$;

revoke all on function public.record_notification_acceptance(text, text, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.record_notification_acceptance(text, text, timestamptz, uuid)
  to service_role;

-- Return only real cancellations whose expected recipient channel is still
-- missing from the outbox. A fixed "latest 100" scan can starve an older crash
-- gap forever; this query naturally advances as each missing claim is written.
create or replace function public.list_cancellation_notification_gaps(
  p_since timestamptz,
  p_limit integer default 100
)
returns table (
  id uuid,
  status public.booking_status,
  cancelled_by public.cancelled_by_actor,
  total_cents integer,
  refunded_cents integer,
  captured_at timestamptz,
  authorized_at timestamptz
)
language plpgsql
-- The expected-channel check needs auth.users, which is deliberately outside
-- the Data API role's direct grants. The function returns no identity data,
-- has an empty search path and is executable only by service_role.
security definer
set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 200 then
    raise exception 'p_limit must be between 1 and 200';
  end if;

  return query
  select b.id, b.status, b.cancelled_by, b.total_cents, b.refunded_cents,
    b.captured_at, b.authorized_at
  from public.bookings b
  join public.spaces s on s.id = b.space_id
  left join auth.users practitioner_user on practitioner_user.id = b.practitioner_id
  left join auth.users host_user on host_user.id = s.host_id
  left join public.profiles practitioner_profile on practitioner_profile.id = b.practitioner_id
  where b.cancelled_at >= p_since
    and b.cancelled_by is not null
    and b.financial_resolution_state = 'resolved'
    and (
      b.captured_at is not null
      or (
        b.authorized_at is not null
        and b.financial_resolution_attempts > 0
        and b.financial_resolved_at is not null
      )
    )
    and (
      (
        b.cancelled_by = 'host'
        and (
          (
            practitioner_user.email is not null
            and not exists (
              select 1 from public.notifications n
              where n.dedupe_key =
                'cancelled_by_host:' || b.id::text || ':email'
            )
          )
          or (
            practitioner_profile.notify_sms is true
            and practitioner_profile.phone_verified_at is not null
            and practitioner_profile.phone is not null
            and not exists (
              select 1 from public.notifications n
              where n.dedupe_key =
                'cancelled_by_host:' || b.id::text || ':sms'
            )
          )
        )
      )
      or (
        b.cancelled_by = 'practitioner'
        and (
          (
            practitioner_user.email is not null
            and not exists (
              select 1 from public.notifications n
              where n.dedupe_key =
                'cancelled_by_practitioner:' || b.id::text || ':email'
            )
          )
          or (
            host_user.email is not null
            and not exists (
              select 1 from public.notifications n
              where n.dedupe_key =
                'cancelled_by_practitioner:' || b.id::text || ':host:email'
            )
          )
        )
      )
    )
  order by b.cancelled_at asc, b.id asc
  limit p_limit;
end;
$$;

revoke all on function public.list_cancellation_notification_gaps(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.list_cancellation_notification_gaps(timestamptz, integer)
  to service_role;

-- Every request answer is durable, but either the webhook or financial worker
-- can stop between recording provider truth and claiming the email. Return
-- only missing practitioner receipts so the frequent worker repairs that gap.
create or replace function public.list_request_outcome_notification_gaps(
  p_since timestamptz,
  p_limit integer default 100
)
returns table (id uuid, approval_state text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 200 then
    raise exception 'p_limit must be between 1 and 200';
  end if;

  return query
  select b.id, b.approval_state
  from public.bookings b
  join auth.users practitioner_user on practitioner_user.id = b.practitioner_id
  where b.approval_state in ('approved', 'declined', 'expired')
    and (
      (
        b.approval_state = 'approved'
        and b.status = 'upcoming'
        and b.cancelled_at is null
        and b.captured_at is not null
        and b.financial_resolution_state in ('not_required', 'resolved')
      )
      or (
        b.approval_state in ('declined', 'expired')
        and b.financial_resolution_state = 'resolved'
      )
    )
    and b.approval_decided_at >= p_since
    and practitioner_user.email is not null
    and not exists (
      select 1
      from public.notifications n
      where n.dedupe_key = case b.approval_state
        when 'approved' then 'request_approved:' || b.id::text || ':email'
        when 'declined' then 'request_declined:' || b.id::text || ':email'
        else 'request_expired:' || b.id::text || ':email'
      end
    )
  order by b.approval_decided_at asc, b.id asc
  limit p_limit;
end;
$$;

revoke all on function public.list_request_outcome_notification_gaps(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.list_request_outcome_notification_gaps(timestamptz, integer)
  to service_role;

-- Pending rows from the old design have no immutable body. Guessing their
-- financial context is worse than dropping them; all newly queued rows carry
-- a v1 snapshot and can be retried exactly.
update public.notifications
set dropped_at = coalesce(dropped_at, now()),
    failed_at = coalesce(failed_at, now()),
    provider_status = 'failed',
    last_error = coalesce(last_error, 'legacy notification has no immutable payload')
where sent_at is null
  and dropped_at is null
  and message_snapshot is null;

-- The base table contains private destinations and immutable message bodies.
-- Browser roles keep only the old, explicit safe-column grant used by the
-- security-invoker view; new columns are never exposed.
revoke all on table public.notifications from anon;
revoke all on table public.notifications from authenticated;
grant select (
  id, user_id, booking_id, kind, channel, sent_at, dropped_at,
  provider_status, created_at
)
  on public.notifications to authenticated;

grant select, insert, update on table public.notifications to service_role;

create or replace view public.my_notifications
with (security_invoker = true) as
  select
    id,
    booking_id,
    kind,
    channel,
    sent_at,
    created_at,
    case
      when provider_status in ('failed', 'bounced', 'complained', 'suppressed')
        or dropped_at is not null then 'failed'
      when sent_at is not null then 'sent'
      else 'queued'
    end as state
  from public.notifications
  where user_id = (select auth.uid());

grant select on public.my_notifications to authenticated;
