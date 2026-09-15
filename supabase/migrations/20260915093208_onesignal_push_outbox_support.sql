-- OneSignal returns HTTP 200 without a notification id when every subscription
-- attached to the external_id is absent or unsubscribed. That closes the row
-- without being an operator-visible delivery failure.
alter table public.notifications
  drop constraint if exists notifications_provider_status_valid;

alter table public.notifications
  add constraint notifications_provider_status_valid
  check (provider_status in (
    'queued', 'accepted', 'delayed', 'delivered', 'unsubscribed',
    'failed', 'bounced', 'complained', 'suppressed'
  ));

-- Provider identifiers are only unique inside a provider/channel namespace.
-- Resend and OneSignal are allowed to return the same opaque string, while a
-- duplicate within one channel remains rejected.
drop index if exists public.notifications_provider_message_id_uidx;

create unique index notifications_provider_message_id_uidx
  on public.notifications (channel, provider_message_id)
  where provider_message_id is not null and provider_message_id <> 'unknown';

-- Push is a delivery companion to the existing in-app notification history,
-- not a second semantic event. Hiding push rows prevents duplicate cards.
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
  where user_id = (select auth.uid())
    and channel <> 'push';

grant select on public.my_notifications to authenticated;

-- A signed Resend event is authoritative only for email. Provider ids are now
-- namespaced by channel, so an email event must never mutate a push/SMS row
-- that happens to carry the same id.
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
  where channel = 'email'
    and (
      provider_message_id = p_resend_email_id
      or (
        p_notification_correlation_id is not null
        and provider_correlation_id = p_notification_correlation_id
      )
    )
    and (
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

-- Acceptance is channel-generic, but only email can race a stored Resend
-- webhook. The channel guard avoids treating a OneSignal/Twilio id as email.
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
  accepted_channel public.notification_channel;
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

  select n.provider_correlation_id, n.channel
    into notification_correlation, accepted_channel
  from public.notifications n
  where n.dedupe_key = p_dedupe_key;

  if accepted_channel = 'email' and (
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
