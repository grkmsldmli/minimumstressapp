-- What the room is being used for, who decides, and who agreed.
--
-- Until now a booking recorded an hour and a payment and nothing about what
-- would happen in the room. That is a gap with two edges.
--
-- The market edge: the app assumed the person booking was a professional
-- seeing a client, so two friends who want a studio for an hour of dance
-- practice had nowhere to say so. That is real demand turned away for no
-- safety gain — a practitioner can misuse a room exactly as easily as anybody
-- else.
--
-- The safety edge is the serious one. With nothing declared, a misuse is a
-- disagreement about what was meant rather than a stated falsehood, and there
-- is nothing to cancel a booking or suspend an account over. The declaration
-- does not prevent anything; it makes enforcement possible, which is the part
-- that was missing.
--
-- Everything here is backward compatible on purpose. Every column has a
-- default that leaves existing rows valid and existing listings bookable —
-- a migration that made every room require an answer nobody had given yet
-- would have taken the marketplace down to nothing on the day it ran.

-- ------------------------------------------------------------------
-- What the host allows, and how a booking reaches them
-- ------------------------------------------------------------------

alter table spaces
  /*
   * Empty means "everything the platform allows", not "nothing" — see
   * `allowsUse` in src/lib/booking-use.ts. Every listing that predates this
   * question has an empty array, and reading that as a refusal would unlist
   * them all.
   */
  add column if not exists allowed_uses text[] not null default '{}',
  /*
   * How a booking becomes a booking. `request` means the host says yes first;
   * `instant` means it goes through when the rules match.
   *
   * Existing listings default to `instant` because that is what they have
   * been doing since they were created, and changing the behaviour of a live
   * listing underneath a host is not a migration's job. New listings default
   * to `request` in the form, which is a decision the host makes with the
   * screen in front of them.
   */
  add column if not exists booking_mode text not null default 'instant';

alter table spaces drop constraint if exists spaces_booking_mode_known;

alter table spaces add constraint spaces_booking_mode_known check (
  booking_mode in ('request', 'instant')
);

-- ------------------------------------------------------------------
-- What was declared, and what happened to the request
-- ------------------------------------------------------------------

alter table bookings
  /*
   * Null on every booking made before this existed. Not backfilled with a
   * guess: "we do not know what this was for" is the true answer for those
   * rows, and inventing `personal_practice` would put a declaration in a
   * dispute record that nobody ever made.
   */
  add column if not exists purpose text,
  add column if not exists purpose_note text,
  add column if not exists attendee_count integer,
  add column if not exists approval_state text not null default 'not_required',
  add column if not exists approval_decided_at timestamptz,
  add column if not exists approval_note text;

comment on column bookings.purpose is
  'Declared at booking, from BOOKING_USES in src/lib/booking-use.ts. Never rewritten — see the trigger below.';
comment on column bookings.attendee_count is
  'Everybody who will be in the room, the person booking included.';

alter table bookings drop constraint if exists bookings_attendees_sane;

alter table bookings add constraint bookings_attendees_sane check (
  attendee_count is null or attendee_count between 1 and 200
);

alter table bookings drop constraint if exists bookings_approval_state_known;

alter table bookings add constraint bookings_approval_state_known check (
  approval_state in ('not_required', 'pending', 'approved', 'declined', 'expired')
);

comment on column bookings.approval_state is
  'not_required on an instant booking. pending holds the card without taking it; approved captures that hold, declined and expired release it. See src/lib/booking-approval.ts.';

/*
 * The declaration is evidence, so it does not change.
 *
 * Its whole value is that it was made before the session and cannot be
 * revised after it. A purpose that can be edited once something has gone
 * wrong is not a record of what somebody said they would do; it is a record of
 * what they would now prefer to have said.
 *
 * Written as a trigger rather than left to the application because the
 * application is not the only thing that can write here, and because a rule
 * about evidence should not depend on every future caller remembering it.
 */
create or replace function freeze_booking_purpose()
returns trigger
language plpgsql
as $$
begin
  if old.purpose is not null and new.purpose is distinct from old.purpose then
    raise exception 'A booking''s declared purpose cannot be changed once it is set';
  end if;

  if old.purpose_note is not null and new.purpose_note is distinct from old.purpose_note then
    raise exception 'A booking''s declared purpose cannot be changed once it is set';
  end if;

  if old.attendee_count is not null and new.attendee_count is distinct from old.attendee_count then
    raise exception 'The number of people declared on a booking cannot be changed once it is set';
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_purpose_is_evidence on bookings;

create trigger bookings_purpose_is_evidence
  before update on bookings
  for each row
  execute function freeze_booking_purpose();

/*
 * A host approving or declining their own room's booking.
 *
 * Both of these are taken straight back out in 0051, and the reasoning there
 * is worth reading before anybody adds them again: answering a request is a
 * write *and* a movement of money, and a grant that allows the first without
 * the second lets a host leave a guest's card held on a booking the app shows
 * as refused. The answer goes through the server, on the service role.
 *
 * Left in place rather than edited away because this migration has already run
 * against the live database. A migration that has run is history.
 */
grant update (approval_state, approval_decided_at, approval_note) on bookings to authenticated;

drop policy if exists "bookings: host answers a request on their own space" on bookings;

create policy "bookings: host answers a request on their own space"
  on bookings for update
  using (
    exists (
      select 1 from spaces s
      where s.id = bookings.space_id
        and s.host_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from spaces s
      where s.id = bookings.space_id
        and s.host_id = auth.uid()
    )
  );

-- The two axes a host's own queue is read on.
create index if not exists bookings_awaiting_host_idx
  on bookings (space_id, starts_at)
  where approval_state = 'pending';

-- ------------------------------------------------------------------
-- The public view carries what a person deciding needs
-- ------------------------------------------------------------------

drop view if exists spaces_public;

create view spaces_public as
  select
    id, host_id, name, category, hourly_rate_cents, capacity, access_type,
    accessible, restroom, buffer_minutes, timezone, status, created_at,
    description, amenities, requirements, house_rules,
    map_x, map_y,
    entrance_access, floor_access, doorway_inches, restroom_access,
    parking, parking_limit_minutes,
    floor_area_sqft,
    -- Public since 0032: every listing is a retail studio whose address is
    -- already on its own website. How to get in is still not here.
    address_line,
    lat,
    lng,
    public_area(address_line) as area,
    city, state, postal_code, suitable_for, room_setup,
    allowed_uses, booking_mode
  from spaces
  where status = 'active';

grant select on spaces_public to anon, authenticated;
grant select on spaces_public to service_role;
