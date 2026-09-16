-- Consent-safe marketing lifecycle delivery.
--
-- Marketing never shares the transactional notification queue. A separate
-- outbox makes consent, frequency caps, one-click unsubscribe and provider
-- complaints impossible to bypass accidentally from booking/safety code.

alter table public.profiles
  add column if not exists marketing_unsubscribe_reason text;

alter table public.profiles
  drop constraint if exists profiles_marketing_unsubscribe_reason_valid;
alter table public.profiles
  add constraint profiles_marketing_unsubscribe_reason_valid check (
    marketing_unsubscribe_reason is null
    or marketing_unsubscribe_reason in (
      'in_app', 'one_click', 'provider_bounce',
      'provider_complaint', 'provider_suppressed'
    )
  );

alter table public.profiles
  drop constraint if exists profiles_marketing_unsubscribe_reason_consistent;
alter table public.profiles
  add constraint profiles_marketing_unsubscribe_reason_consistent check (
    marketing_unsubscribe_reason is null
    or (
      notify_offers is false
      and marketing_unsubscribed_at is not null
    )
  );

create or replace function public.record_marketing_preference_change()
returns trigger
language plpgsql
set search_path = 'public', 'pg_temp'
as $$
begin
  if tg_op = 'INSERT' then
    if current_user = 'authenticated' then
      new.marketing_unsubscribe_token := gen_random_uuid();
      if new.notify_offers then
        new.marketing_consent_at := now();
        new.marketing_unsubscribed_at := null;
        new.marketing_unsubscribe_reason := null;
        new.marketing_consent_source := 'in_app_settings';
      else
        new.marketing_consent_at := null;
        new.marketing_unsubscribed_at := null;
        new.marketing_unsubscribe_reason := null;
        new.marketing_consent_source := null;
      end if;
    end if;
    return new;
  end if;

  if current_user = 'authenticated' then
    -- Evidence columns and unsubscribe tokens are server-owned.
    new.marketing_unsubscribe_token := old.marketing_unsubscribe_token;
    if new.notify_offers is distinct from old.notify_offers then
      if new.notify_offers then
        new.marketing_consent_at := now();
        new.marketing_unsubscribed_at := null;
        new.marketing_unsubscribe_reason := null;
        new.marketing_consent_source := 'in_app_settings';
      else
        new.marketing_consent_at := old.marketing_consent_at;
        new.marketing_unsubscribed_at := now();
        new.marketing_unsubscribe_reason := 'in_app';
        new.marketing_consent_source := old.marketing_consent_source;
      end if;
    else
      new.marketing_consent_at := old.marketing_consent_at;
      new.marketing_unsubscribed_at := old.marketing_unsubscribed_at;
      new.marketing_unsubscribe_reason := old.marketing_unsubscribe_reason;
      new.marketing_consent_source := old.marketing_consent_source;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.record_marketing_preference_change()
  from public, anon, authenticated;
grant execute on function public.record_marketing_preference_change()
  to service_role;

-- Recreate the existing trigger so the newly added reason is server-owned as
-- well. Without this, an authenticated profile update containing only that
-- column would not invoke the evidence guard.
drop trigger if exists profiles_record_marketing_preference on public.profiles;
create trigger profiles_record_marketing_preference
  before insert or update of notify_offers, marketing_consent_at,
    marketing_unsubscribed_at, marketing_unsubscribe_reason,
    marketing_consent_source, marketing_unsubscribe_token
  on public.profiles
  for each row execute function public.record_marketing_preference_change();

-- Only the latest coarse timestamps needed to choose a lifecycle are kept.
-- No listing id, search text, route, device identifier or location is stored.
create table if not exists public.marketing_activity (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_app_opened_at timestamptz,
  last_space_browsed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint marketing_activity_has_fact check (
    last_app_opened_at is not null or last_space_browsed_at is not null
  )
);

alter table public.marketing_activity enable row level security;
revoke all on table public.marketing_activity from public, anon, authenticated, service_role;
grant select, insert, update on table public.marketing_activity to service_role;

create table if not exists public.marketing_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign text not null check (campaign in (
    'onboarding_incomplete',
    'host_listed_no_bookings',
    'browsed_no_booking',
    'first_booking_follow_up',
    'rebooking',
    'dormant_reactivation',
    'host_inventory_engagement'
  )),
  campaign_version integer not null check (campaign_version between 1 and 1000),
  dedupe_key text not null unique check (length(dedupe_key) between 10 and 240),
  subject text,
  text_body text,
  html_body text,
  state text not null default 'queued' check (
    state in ('queued', 'sending', 'accepted', 'delivered', 'failed', 'suppressed')
  ),
  attempts integer not null default 0 check (attempts between 0 and 8),
  send_after timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  expires_at timestamptz not null,
  lease_token uuid,
  lease_until timestamptz,
  provider_message_id text,
  provider_correlation_id text not null unique check (
    provider_correlation_id ~ '^[a-f0-9]{64}$'
  ),
  provider_status text not null default 'queued' check (
    provider_status in (
      'queued', 'accepted', 'delayed', 'delivered',
      'failed', 'bounced', 'complained', 'suppressed'
    )
  ),
  provider_event_at timestamptz,
  accepted_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  suppressed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_outbox_lease_consistent check (
    (lease_token is null) = (lease_until is null)
  ),
  constraint marketing_outbox_window_valid check (
    expires_at > send_after
  ),
  constraint marketing_outbox_subject_safe check (
    subject is null
    or (length(subject) between 1 and 200 and subject !~ E'[\\r\\n]')
  ),
  constraint marketing_outbox_text_bounded check (
    text_body is null or length(text_body) between 1 and 20000
  ),
  constraint marketing_outbox_html_bounded check (
    html_body is null or length(html_body) between 1 and 100000
  ),
  constraint marketing_outbox_payload_consistent check (
    (
      state in ('queued', 'sending')
      and subject is not null
      and text_body is not null
      and html_body is not null
    )
    or (
      state in ('accepted', 'delivered', 'failed', 'suppressed')
      and subject is null
      and text_body is null
      and html_body is null
    )
  )
);

create index if not exists marketing_outbox_due_idx
  on public.marketing_outbox (next_attempt_at, send_after, created_at)
  where state in ('queued', 'sending');
create index if not exists marketing_outbox_user_frequency_idx
  on public.marketing_outbox (user_id, created_at desc)
  where state in ('queued', 'sending', 'accepted', 'delivered');
create unique index if not exists marketing_outbox_provider_message_uidx
  on public.marketing_outbox (provider_message_id)
  where provider_message_id is not null and provider_message_id <> 'unknown';

alter table public.marketing_outbox enable row level security;
revoke all on table public.marketing_outbox from public, anon, authenticated, service_role;
grant select, insert, update on table public.marketing_outbox to service_role;

create schema if not exists private;
-- Preserve the narrow USAGE grants needed by existing public invoker facades.
-- No runtime role may create objects in the privileged implementation schema.
revoke create on schema private from public, anon, authenticated, service_role;
grant usage on schema private to service_role;

-- Serialize each user's candidate decision against their profile row, then
-- apply conservative caps atomically: one/day, two/week, four/30 days.
create or replace function private._ms_enqueue_marketing_email_definer(
  p_user_id uuid,
  p_campaign text,
  p_campaign_version integer,
  p_dedupe_key text,
  p_subject text,
  p_text_body text,
  p_html_body text,
  p_provider_correlation_id text,
  p_send_after timestamptz,
  p_expires_at timestamptz,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  consented boolean;
begin
  select (
    p.notify_offers
    and p.marketing_consent_at is not null
    and p.marketing_unsubscribed_at is null
  )
  into consented
  from public.profiles p
  where p.id = p_user_id
  for update;

  if not coalesce(consented, false) then return false; end if;

  if exists (
    select 1 from public.marketing_outbox m
    where m.user_id = p_user_id
      and m.state in ('queued', 'sending', 'accepted', 'delivered')
      and m.created_at >= p_now - interval '24 hours'
  ) then return false; end if;

  if 2 <= (
    select count(*) from public.marketing_outbox m
    where m.user_id = p_user_id
      and m.state in ('queued', 'sending', 'accepted', 'delivered')
      and m.created_at >= p_now - interval '7 days'
  ) then return false; end if;

  if 4 <= (
    select count(*) from public.marketing_outbox m
    where m.user_id = p_user_id
      and m.state in ('queued', 'sending', 'accepted', 'delivered')
      and m.created_at >= p_now - interval '30 days'
  ) then return false; end if;

  insert into public.marketing_outbox (
    user_id, campaign, campaign_version, dedupe_key,
    subject, text_body, html_body, provider_correlation_id,
    send_after, next_attempt_at, expires_at, created_at, updated_at
  ) values (
    p_user_id, p_campaign, p_campaign_version, p_dedupe_key,
    p_subject, p_text_body, p_html_body, p_provider_correlation_id,
    p_send_after, p_send_after, p_expires_at, p_now, p_now
  );

  return true;
exception when unique_violation then
  return false;
end;
$$;

revoke all on function private._ms_enqueue_marketing_email_definer(
  uuid, text, integer, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function private._ms_enqueue_marketing_email_definer(
  uuid, text, integer, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz
) to service_role;

create or replace function public.enqueue_marketing_email(
  p_user_id uuid,
  p_campaign text,
  p_campaign_version integer,
  p_dedupe_key text,
  p_subject text,
  p_text_body text,
  p_html_body text,
  p_provider_correlation_id text,
  p_send_after timestamptz,
  p_expires_at timestamptz,
  p_now timestamptz default now()
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private._ms_enqueue_marketing_email_definer(
    p_user_id, p_campaign, p_campaign_version, p_dedupe_key,
    p_subject, p_text_body, p_html_body, p_provider_correlation_id,
    p_send_after, p_expires_at, p_now
  );
$$;

revoke all on function public.enqueue_marketing_email(
  uuid, text, integer, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.enqueue_marketing_email(
  uuid, text, integer, text, text, text, text, text,
  timestamptz, timestamptz, timestamptz
) to service_role;

create or replace function public.claim_marketing_email_batch(
  p_worker uuid,
  p_limit integer default 25,
  p_now timestamptz default now()
)
returns table (
  id uuid,
  user_id uuid,
  campaign text,
  dedupe_key text,
  subject text,
  text_body text,
  html_body text,
  provider_correlation_id text,
  attempts integer,
  lease_token uuid,
  unsubscribe_token uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_worker is null then raise exception 'p_worker is required'; end if;
  if p_limit < 1 or p_limit > 100 then
    raise exception 'p_limit must be between 1 and 100';
  end if;

  -- Consent is checked again at claim time. Opt-outs also destroy the pending
  -- envelope, so a later bug cannot resurrect its copy.
  update public.marketing_outbox m
  set state = 'suppressed',
      provider_status = 'suppressed',
      suppressed_at = p_now,
      subject = null,
      text_body = null,
      html_body = null,
      last_error = 'marketing consent withdrawn',
      lease_token = null,
      lease_until = null,
      updated_at = p_now
  where m.state in ('queued', 'sending')
    and (m.lease_until is null or m.lease_until <= p_now)
    and not exists (
      select 1 from public.profiles p
      where p.id = m.user_id
        and p.notify_offers
        and p.marketing_consent_at is not null
        and p.marketing_unsubscribed_at is null
    );

  update public.marketing_outbox m
  set state = 'failed',
      provider_status = 'failed',
      failed_at = p_now,
      subject = null,
      text_body = null,
      html_body = null,
      last_error = case
        when m.expires_at <= p_now then 'marketing email expired'
        else 'marketing retry attempts exhausted'
      end,
      lease_token = null,
      lease_until = null,
      updated_at = p_now
  where m.state in ('queued', 'sending')
    and (m.lease_until is null or m.lease_until <= p_now)
    and (m.expires_at <= p_now or m.attempts >= 8);

  return query
  with due as (
    select m.id
    from public.marketing_outbox m
    join public.profiles p on p.id = m.user_id
    where m.state in ('queued', 'sending')
      and m.attempts < 8
      and m.send_after <= p_now
      and m.next_attempt_at <= p_now
      and m.expires_at > p_now
      and (m.lease_until is null or m.lease_until <= p_now)
      and p.notify_offers
      and p.marketing_consent_at is not null
      and p.marketing_unsubscribed_at is null
    order by m.next_attempt_at, m.created_at, m.id
    for update of m skip locked
    limit p_limit
  ), claimed as (
    update public.marketing_outbox m
    set state = 'sending',
        attempts = m.attempts + 1,
        lease_token = p_worker,
        lease_until = p_now + interval '15 minutes',
        updated_at = p_now
    from due
    where m.id = due.id
    returning m.*
  )
  select c.id, c.user_id, c.campaign, c.dedupe_key,
    c.subject, c.text_body, c.html_body, c.provider_correlation_id,
    c.attempts, c.lease_token, p.marketing_unsubscribe_token
  from claimed c
  join public.profiles p on p.id = c.user_id;
end;
$$;

revoke all on function public.claim_marketing_email_batch(uuid, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_marketing_email_batch(uuid, integer, timestamptz)
  to service_role;

create or replace function public.record_marketing_email_acceptance(
  p_id uuid,
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
  changed integer;
  correlation text;
  latest_event record;
begin
  update public.marketing_outbox m
  set state = 'accepted',
      provider_message_id = nullif(p_provider_message_id, 'unknown'),
      provider_status = 'accepted',
      accepted_at = coalesce(m.accepted_at, p_accepted_at),
      subject = null,
      text_body = null,
      html_body = null,
      last_error = null,
      lease_token = null,
      lease_until = null,
      updated_at = p_accepted_at
  where m.id = p_id
    and m.state = 'sending'
    and m.lease_token = p_lease_token;

  get diagnostics changed = row_count;
  if changed = 0 then return false; end if;

  select m.provider_correlation_id into correlation
  from public.marketing_outbox m where m.id = p_id;

  select e.event_type, e.event_created_at into latest_event
  from public.resend_email_events e
  where (
      p_provider_message_id is not null
      and p_provider_message_id <> 'unknown'
      and e.resend_email_id = p_provider_message_id
    )
    or e.notification_correlation_id = correlation
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
      correlation,
      latest_event.event_type,
      latest_event.event_created_at
    );
  end if;
  return true;
end;
$$;

revoke all on function public.record_marketing_email_acceptance(uuid, text, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.record_marketing_email_acceptance(uuid, text, timestamptz, uuid)
  to service_role;

-- Extend the existing signed Resend reducer to the marketing outbox. Provider
-- complaint, suppression and permanent bounce also revoke future marketing
-- consent; transactional booking/safety delivery remains untouched.
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
  notification_affected integer := 0;
  marketing_affected integer := 0;
  affected_users uuid[] := '{}'::uuid[];
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
  if next_status is null then return 0; end if;

  next_rank := case next_status
    when 'accepted' then 1 when 'delayed' then 2 when 'delivered' then 3
    when 'failed' then 4 when 'bounced' then 5 when 'suppressed' then 6
    when 'complained' then 7 else 0
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
      delivered_at = case when next_status = 'delivered' then p_event_created_at else delivered_at end,
      failed_at = case
        when next_status in ('failed', 'bounced', 'complained', 'suppressed') then p_event_created_at
        when next_status in ('delayed', 'delivered') then null else failed_at end,
      dropped_at = case when next_status in ('delayed', 'delivered') then null else dropped_at end,
      destination = null,
      message_snapshot = null,
      lease_token = null,
      lease_until = null
  where channel = 'email'
    and (
      provider_message_id = p_resend_email_id
      or (p_notification_correlation_id is not null and provider_correlation_id = p_notification_correlation_id)
    )
    and (
      provider_event_at is null
      or next_rank > case provider_status
        when 'accepted' then 1 when 'delayed' then 2 when 'delivered' then 3
        when 'failed' then 4 when 'bounced' then 5 when 'suppressed' then 6
        when 'complained' then 7 else 0 end
      or (
        next_rank = case provider_status
          when 'accepted' then 1 when 'delayed' then 2 when 'delivered' then 3
          when 'failed' then 4 when 'bounced' then 5 when 'suppressed' then 6
          when 'complained' then 7 else 0 end
        and p_event_created_at > provider_event_at
      )
    );
  get diagnostics notification_affected = row_count;

  with changed as (
    update public.marketing_outbox m
    set state = case
          when next_status = 'delivered' then 'delivered'
          when next_status = 'failed' then 'failed'
          when next_status in ('bounced', 'complained', 'suppressed') then 'suppressed'
          else 'accepted'
        end,
        provider_message_id = coalesce(m.provider_message_id, p_resend_email_id),
        provider_status = next_status,
        provider_event_at = p_event_created_at,
        accepted_at = coalesce(m.accepted_at, p_event_created_at),
        delivered_at = case when next_status = 'delivered' then p_event_created_at else m.delivered_at end,
        failed_at = case
          when next_status = 'failed' then p_event_created_at
          when next_status in ('delayed', 'delivered') then null else m.failed_at end,
        suppressed_at = case
          when next_status in ('bounced', 'complained', 'suppressed') then p_event_created_at
          else m.suppressed_at end,
        last_error = case
          when next_status = 'delivered' then null
          when next_status in ('failed', 'bounced', 'complained', 'suppressed')
            then 'provider event: ' || p_event_type
          else m.last_error end,
        subject = null,
        text_body = null,
        html_body = null,
        lease_token = null,
        lease_until = null,
        updated_at = p_event_created_at
    where (
        m.provider_message_id = p_resend_email_id
        or (p_notification_correlation_id is not null and m.provider_correlation_id = p_notification_correlation_id)
      )
      and (
        m.provider_event_at is null
        or next_rank > case m.provider_status
          when 'accepted' then 1 when 'delayed' then 2 when 'delivered' then 3
          when 'failed' then 4 when 'bounced' then 5 when 'suppressed' then 6
          when 'complained' then 7 else 0 end
        or (
          next_rank = case m.provider_status
            when 'accepted' then 1 when 'delayed' then 2 when 'delivered' then 3
            when 'failed' then 4 when 'bounced' then 5 when 'suppressed' then 6
            when 'complained' then 7 else 0 end
          and p_event_created_at > m.provider_event_at
        )
      )
    returning m.user_id
  )
  select coalesce(array_agg(distinct user_id), '{}'::uuid[]), count(*)
  into affected_users, marketing_affected
  from changed;

  if next_status in ('bounced', 'complained', 'suppressed')
     and cardinality(affected_users) > 0 then
    update public.profiles p
    set notify_offers = false,
        marketing_unsubscribed_at = p_event_created_at,
        marketing_unsubscribe_reason = case next_status
          when 'bounced' then 'provider_bounce'
          when 'complained' then 'provider_complaint'
          else 'provider_suppressed'
        end
    where p.id = any(affected_users);
  end if;

  return notification_affected + marketing_affected;
end;
$$;

revoke all on function public.apply_resend_delivery_event(text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_resend_delivery_event(text, text, text, timestamptz)
  to service_role;

-- A DB scheduler bearer is stored only as a SHA-256 digest. The plaintext is
-- provisioned separately in Vault and never appears in a migration or cron.job.
create table if not exists private.scheduler_bearer_hashes (
  name text primary key,
  token_sha256 text not null check (token_sha256 ~ '^[a-f0-9]{64}$'),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  rotated_at timestamptz not null default now()
);
revoke all on table private.scheduler_bearer_hashes
  from public, anon, authenticated, service_role;

create or replace function private._ms_verify_notification_scheduler_token_definer(
  p_token_sha256 text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.scheduler_bearer_hashes s
    where s.name = 'notification_recovery'
      and s.enabled
      and s.token_sha256 = p_token_sha256
  );
$$;

revoke all on function private._ms_verify_notification_scheduler_token_definer(text)
  from public, anon, authenticated;
grant execute on function private._ms_verify_notification_scheduler_token_definer(text)
  to service_role;

create or replace function public.verify_notification_scheduler_token(
  p_token_sha256 text
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private._ms_verify_notification_scheduler_token_definer(p_token_sha256);
$$;

revoke all on function public.verify_notification_scheduler_token(text)
  from public, anon, authenticated;
grant execute on function public.verify_notification_scheduler_token(text)
  to service_role;
