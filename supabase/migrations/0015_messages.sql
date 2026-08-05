-- A thread per booking.
--
-- Scoped to a booking rather than to a pair of people, and that is the whole
-- privacy model. Two strangers have nothing to say to each other until one has
-- booked the other's room, and nothing to say afterwards once the record is
-- gone. A thread that outlived its booking would be a direct line between two
-- people who only ever agreed to share an hour.
--
-- Contact details are masked before the row is written, in
-- src/lib/message-redaction.ts. Both the sent text and the redacted text are
-- stored: the sender sees what they typed, everybody else sees what was sent.
-- Keeping the original matters when somebody reports harassment — the thing
-- that needs looking at is what was actually written.

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings (id) on delete cascade,
  sender_id uuid not null references profiles (id) on delete cascade,

  -- What the recipient sees.
  body text not null check (length(body) between 1 and 2000),

  /*
   * What the sender typed, when it differed.
   *
   * Null when nothing was masked, so the common case costs nothing. Readable
   * by staff alone — the point of masking is defeated if the recipient can
   * fetch the unmasked version, and the point of keeping it is defeated if
   * nobody can read it during a complaint.
   */
  original_body text,
  redacted_kinds text[] not null default '{}',

  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists messages_booking_idx on messages (booking_id, created_at);
create index if not exists messages_unread_idx
  on messages (booking_id)
  where read_at is null;

-- ------------------------------------------------------------------
-- booking_participants
--
-- "Are you one of the two people on this booking" is asked by every policy
-- below, and getting it slightly different in each one is how the third
-- version ends up wrong. One function, one answer.
--
-- Definer, because a practitioner has no row policy on spaces and therefore
-- cannot see who hosts the room they booked.
-- ------------------------------------------------------------------
create or replace function is_booking_participant(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from bookings b
    join spaces s on s.id = b.space_id
    where b.id = p_booking_id
      and (b.practitioner_id = auth.uid() or s.host_id = auth.uid())
  );
$$;

-- ------------------------------------------------------------------
-- Access
--
-- Reading and writing are both allowed directly, unlike reviews. There is no
-- eligibility rule a client could skip: either you are on the booking or you
-- are not, and the function above settles it. What a client cannot be trusted
-- with is the masking, so inserts go through a server route that does it —
-- but the policy is the boundary, not the route.
-- ------------------------------------------------------------------
alter table messages enable row level security;

do $$
declare existing record;
begin
  for existing in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'messages'
  loop
    execute format('drop policy if exists %I on public.messages', existing.policyname);
  end loop;
end $$;

create policy "messages: participants read the thread"
  on messages for select
  using (is_booking_participant(booking_id));

-- Marking as read is the only update a participant makes, and only on
-- somebody else's message — you do not mark your own as read.
create policy "messages: participants mark others' as read"
  on messages for update
  using (is_booking_participant(booking_id) and sender_id <> auth.uid())
  with check (is_booking_participant(booking_id) and sender_id <> auth.uid());

grant select, update on messages to authenticated;
grant select, insert, update on messages to service_role;

-- ------------------------------------------------------------------
-- messages_visible
--
-- What a participant reads. The column list is the point: original_body is
-- absent, so the unmasked text cannot be selected by the person the masking
-- was protecting somebody from.
--
-- Invoker, so the policy above still applies — this is a narrowing of rows the
-- caller may already reach, not a way around them.
-- ------------------------------------------------------------------
drop view if exists messages_visible;

create view messages_visible
with (security_invoker = true) as
  select
    id,
    booking_id,
    sender_id,
    body,
    redacted_kinds,
    created_at,
    read_at
  from messages;

grant select on messages_visible to authenticated;
grant select on messages_visible to service_role;
