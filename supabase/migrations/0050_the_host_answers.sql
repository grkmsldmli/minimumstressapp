-- The queue a host answers from.
--
-- `host_bookings()` cannot carry this and should not be made to. It filters on
-- `captured_at is not null` — money arrived, or it never happened — which is
-- exactly right for a list of sessions and exactly wrong for a list of
-- requests, because a request holds the card rather than charging it and is
-- uncaptured until the host says yes. Loosening that filter would put
-- abandoned checkouts and unanswered requests into a host's earnings list.
--
-- So: a second function, for a different question. What is waiting on me.
--
-- It carries the declaration with it. A host deciding needs what the room is
-- for and how many people are coming in the same row as the hour, because
-- a queue that makes them open something else to find out is a queue that
-- gets answered late or not at all.

drop function if exists host_requests();

create function host_requests()
returns table (
  booking_id uuid,
  space_id uuid,
  space_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  requested_at timestamptz,
  net_cents integer,
  practitioner_name text,
  practitioner_avatar_path text,
  purpose text,
  purpose_note text,
  attendee_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id,
    b.space_id,
    s.name,
    b.starts_at,
    b.ends_at,
    b.created_at,
    -- The host's rate, never the total. What the practitioner paid is not
    -- theirs to see, and host_bookings() draws the same line.
    b.host_rate_cents,
    p.display_name,
    p.avatar_path,
    b.purpose,
    b.purpose_note,
    b.attendee_count
  from bookings b
  join spaces s on s.id = b.space_id
  join profiles p on p.id = b.practitioner_id
  where s.host_id = auth.uid()
    and b.approval_state = 'pending'
    and b.status = 'upcoming'
    /*
     * A card was actually entered. Between the row being written and the
     * payment sheet being completed there is a booking with no authorisation
     * behind it, and showing that to a host would put a request in their queue
     * that somebody may be about to abandon — they would approve it, and there
     * would be nothing to capture.
     */
    and b.authorized_at is not null
  -- Soonest session first: the one closest to happening is the one whose
  -- answer matters most, and the one that will expire first.
  order by b.starts_at;
$$;

revoke all on function host_requests() from public;
grant execute on function host_requests() to authenticated;

-- ------------------------------------------------------------------
-- What the person who made the request can see
-- ------------------------------------------------------------------
--
-- Two things are wrong with the view as it stands, and both hide a booking
-- from the person who made it.
--
-- The request itself. `listMyBookings` keeps only rows with `captured_at`,
-- because an abandoned checkout is not a session somebody had. A request is
-- uncaptured by design — the card is held, not charged — so a guest would pay,
-- watch their request disappear, and have no way to tell whether it had been
-- sent. `approval_state` and `authorized_at` are added here so that filter can
-- tell the two apart: money held is evidence exactly as money taken is.
--
-- And `is_instant` and `was_pro`, which 0048 dropped from the column list while
-- rewriting the access-code case. Nothing complained, because the app reads
-- this view with `select *` into an untyped row — so both fields simply became
-- undefined on every booking a practitioner looked at. Restored here.

drop view if exists bookings_with_access_code;

create view bookings_with_access_code
with (security_invoker = true) as
  select
    b.id, b.space_id, b.practitioner_id, b.starts_at, b.ends_at, b.status,
    b.is_instant, b.was_pro,
    b.host_rate_cents, b.service_fee_cents,
    b.instant_fee_cents, b.pro_discount_cents, b.credit_applied_cents,
    b.total_cents, b.platform_cents, b.captured_at, b.cancelled_at,
    b.cancelled_by, b.access_code_revealed_at, b.created_at,
    -- The request, from the side that made it.
    b.approval_state, b.approval_decided_at, b.approval_note, b.authorized_at,
    b.purpose, b.purpose_note, b.attendee_count,
    case
      when b.practitioner_id = auth.uid()
       and b.access_code_revealed_at <= now()
       /*
        * Until the hour is over. Not until somebody is paid: the payout is a
        * money event on a twice-daily job, and tying a door to it means the
        * door stays open while a transfer is pending and shuts while a session
        * is still running.
        */
       and now() < b.ends_at
       -- Not cancelled. This is the one thing status is actually being asked.
       and b.status in ('upcoming', 'completed')
       /*
        * And paid for. The row exists from the moment somebody reaches the
        * card form; the hour is theirs only once the money is taken.
        *
        * This is also what keeps a pending request out of a door. A held card
        * is not a captured one, so a request that has not been approved has no
        * code behind it however close to the hour it gets — which is the right
        * answer, because nobody has agreed to let that person in yet.
        */
       and b.captured_at is not null
        then b.access_code
      else null
    end as revealed_access_code
  from bookings b;

grant select on bookings_with_access_code to authenticated;
grant select on bookings_with_access_code to service_role;
