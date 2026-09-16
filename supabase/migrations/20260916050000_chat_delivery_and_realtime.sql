-- Durable chat delivery and privacy-safe Realtime signalling.
--
-- The messages row is the business fact. An AFTER INSERT trigger creates the
-- notification job in the same transaction, so a process crash between the
-- API insert and a provider call cannot lose the alert. The same trigger emits
-- a private Broadcast carrying only an opaque message id. Clients use it only
-- as a reason to re-read messages_visible; original_body is never published.

create table if not exists public.message_notification_jobs (
  message_id uuid primary key references public.messages(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  check ((lease_token is null) = (lease_until is null)),
  check (not (completed_at is not null and failed_at is not null))
);

create index if not exists message_notification_jobs_due_idx
  on public.message_notification_jobs(next_attempt_at, created_at)
  where completed_at is null and failed_at is null;

alter table public.message_notification_jobs enable row level security;
revoke all on table public.message_notification_jobs from public, anon, authenticated;
grant select, insert, update on table public.message_notification_jobs to service_role;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to service_role;

create or replace function private._ms_queue_message_delivery_definer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.message_notification_jobs(message_id, booking_id, sender_id)
  values (new.id, new.booking_id, new.sender_id)
  on conflict (message_id) do nothing;

  -- Realtime is an acceleration path, never the source of truth. If its
  -- managed schema is temporarily unavailable, preserve the message and its
  -- durable notification job; the client's visibility refresh/fallback poll
  -- will still converge.
  begin
    perform realtime.send(
      jsonb_build_object('message_id', new.id),
      'message_created',
      'booking:' || new.booking_id::text || ':messages',
      true
    );
  exception when others then
    raise warning 'safe message broadcast failed for %', new.id;
  end;

  return new;
end;
$$;

revoke all on function private._ms_queue_message_delivery_definer()
  from public, anon, authenticated, service_role;

drop trigger if exists messages_queue_delivery on public.messages;
create trigger messages_queue_delivery
  after insert on public.messages
  for each row execute function private._ms_queue_message_delivery_definer();

-- A private channel is authorized from booking truth. The topic has to match
-- the exact booking:<uuid>:messages form before the cast can run, so a caller
-- cannot turn an arbitrary topic into an exception or a cross-thread oracle.
drop policy if exists "booking participants receive safe message signals"
  on realtime.messages;
create policy "booking participants receive safe message signals"
  on realtime.messages for select
  to authenticated
  using (
    extension = 'broadcast'
    and realtime.topic() ~ '^booking:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:messages$'
    and public.is_booking_participant(
      split_part(realtime.topic(), ':', 2)::uuid
    )
  );

create or replace function private._ms_claim_message_notification_jobs_definer(
  p_worker uuid,
  p_limit integer,
  p_now timestamptz,
  p_message_id uuid default null
)
returns table (
  message_id uuid,
  booking_id uuid,
  sender_id uuid,
  attempts integer,
  lease_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select j.message_id
    from public.message_notification_jobs j
    where j.completed_at is null
      and j.failed_at is null
      and j.next_attempt_at <= p_now
      and (j.lease_until is null or j.lease_until <= p_now)
      and (p_message_id is null or j.message_id = p_message_id)
    order by j.created_at, j.message_id
    for update skip locked
    limit greatest(0, least(coalesce(p_limit, 20), 100))
  )
  update public.message_notification_jobs j
  set attempts = j.attempts + 1,
      lease_token = p_worker,
      lease_until = p_now + interval '5 minutes',
      last_error = null
  from candidates c
  where j.message_id = c.message_id
  returning j.message_id, j.booking_id, j.sender_id, j.attempts, j.lease_token;
end;
$$;

revoke all on function private._ms_claim_message_notification_jobs_definer(
  uuid, integer, timestamptz, uuid
) from public, anon, authenticated, service_role;
grant execute on function private._ms_claim_message_notification_jobs_definer(
  uuid, integer, timestamptz, uuid
) to service_role;

create or replace function public.claim_message_notification_jobs(
  p_worker uuid,
  p_limit integer,
  p_now timestamptz,
  p_message_id uuid default null
)
returns table (
  message_id uuid,
  booking_id uuid,
  sender_id uuid,
  attempts integer,
  lease_token uuid
)
language sql
volatile
security invoker
set search_path = 'pg_catalog'
as $$
  select *
  from private._ms_claim_message_notification_jobs_definer(
    p_worker, p_limit, p_now, p_message_id
  );
$$;

revoke all on function public.claim_message_notification_jobs(
  uuid, integer, timestamptz, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.claim_message_notification_jobs(
  uuid, integer, timestamptz, uuid
) to service_role;
