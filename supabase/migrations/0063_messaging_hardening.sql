-- Messaging hardening — close the original_body leak and the broad update.
--
-- Two boundary defects from 0015, fixed at the database:
--
--   1. authenticated held table-level SELECT on messages, so a participant could
--      read original_body directly and bypass messages_visible — defeating the
--      masking the whole feature exists for. The grant is narrowed to the safe
--      columns; messages_visible (security_invoker) still works because it reads
--      exactly those, and `select original_body` is now refused.
--
--   2. authenticated held UPDATE on messages, and the 0015 policy only checked
--      "participant, not the sender" — not WHICH columns changed — so a
--      participant could rewrite the other side's body, original_body, sender_id,
--      or booking_id. The grant and policy are removed; the one legitimate write,
--      marking a message read, moves to a narrow definer RPC.
--
-- Reading is unchanged: the SELECT policy from 0015 still scopes rows to booking
-- participants, and messages_visible is still the only client read surface.

-- 1. original_body is no longer client-readable.
revoke select, update on messages from authenticated;
grant select (id, booking_id, sender_id, body, redacted_kinds, created_at, read_at)
  on messages to authenticated;

-- 2. No broad client UPDATE. Read state is the RPC below.
drop policy if exists "messages: participants mark others' as read" on messages;

-- ------------------------------------------------------------------
-- mark_messages_read — the only write a client may make to a message.
--
-- Marks the messages in one thread that are addressed to the caller as read, and
-- nothing else: it validates the caller is on the booking, touches only read_at,
-- only on messages the caller did not send, and only ones still unread. A sender
-- can never mark their own outgoing message read on the recipient's behalf, and
-- body, original_body, sender_id, booking_id, created_at and redacted_kinds are
-- unreachable. Idempotent — a second call marks nothing and returns 0. Definer,
-- so it may write read_at even though authenticated now holds no UPDATE grant.
-- ------------------------------------------------------------------
create or replace function mark_messages_read(p_booking_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    return 0;
  end if;
  if not is_booking_participant(p_booking_id) then
    return 0;
  end if;

  update messages
    set read_at = now()
    where booking_id = p_booking_id
      and sender_id <> auth.uid()
      and read_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function mark_messages_read(uuid) from public;
grant execute on function mark_messages_read(uuid) to authenticated;

-- ------------------------------------------------------------------
-- unread_message_counts — server truth for the unread badge.
--
-- One row per thread with an unread incoming message, for the caller. Invoker,
-- so messages_visible's row policy applies and the count covers only threads the
-- caller is on; a message the caller sent never counts toward their own unread.
-- ------------------------------------------------------------------
create or replace function unread_message_counts()
returns table (booking_id uuid, unread integer)
language sql
stable
security invoker
set search_path = public
as $$
  select booking_id, count(*)::integer as unread
  from messages_visible
  where sender_id <> auth.uid()
    and read_at is null
  group by booking_id;
$$;

revoke all on function unread_message_counts() from public;
grant execute on function unread_message_counts() to authenticated;

-- ------------------------------------------------------------------
-- New messages only on a live booking — enforced at the boundary.
--
-- Reading a thread stays open whatever became of the booking, so historical
-- messages remain readable after a cancellation. But a NEW message may be sent
-- only on a booking that is genuinely confirmed: captured (which a pending,
-- declined, or expired request never is) and not cancelled. This trigger is the
-- server-authoritative rule, applied to every insert path including the service
-- role's, so it holds even if a future caller forgets it; the send route checks
-- the same thing first to return a friendly message rather than an exception.
-- Completed and no-show sessions stay open — no new closure window is invented
-- here.
-- ------------------------------------------------------------------
create or replace function enforce_message_sendable()
returns trigger
language plpgsql
as $$
declare
  b record;
begin
  select captured_at, status into b from bookings where id = new.booking_id;
  if b is null
     or b.captured_at is null
     or b.status in ('cancelled_by_practitioner', 'cancelled_by_host') then
    raise exception 'messaging is available only on a confirmed booking'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_sendable on messages;
create trigger messages_sendable
  before insert on messages
  for each row
  execute function enforce_message_sendable();
