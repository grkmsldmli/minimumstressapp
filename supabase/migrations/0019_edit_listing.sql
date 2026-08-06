-- Editing a listing, and what a host may change on their own.
--
-- Until now a listing could not be edited at all. The rate was wrong, or the
-- entry instructions changed, and the only route was to delist and start
-- again — which loses the reviews and the history along with the mistake.
--
-- The rule underneath all of this is one sentence: **a change must never
-- rewrite something somebody has already agreed to.** Everything below is that
-- sentence applied to a particular column.
--
--   Free to change, live immediately
--     name, entry instructions, capacity, turnover buffer, accessibility,
--     restroom, photos. None of these is what a practitioner booked; they
--     describe the room they are walking into, and a host correcting them is
--     the app working.
--
--   Free to change, future bookings only
--     the hourly rate. Bookings freeze their own money at creation, so a rate
--     change cannot reach one that exists. A practitioner who booked at $45
--     pays $45 whatever happens next.
--
--   Sends the listing back for review
--     the address, the room type, or a replaced sublease document. We verified
--     a specific lease for a specific address; changing either means what we
--     checked is not what is listed. It goes back to pending and off search
--     until somebody has looked again.
--
--   Refused outright while sessions are booked
--     the address and the room type. Not "re-reviewed" — refused. Somebody
--     has arranged their day around a room at that address, and moving it
--     underneath them is the exact harm the cancellation policy exists to
--     prevent, done quietly instead of with a notification. A host who has
--     genuinely moved cancels those sessions first, which is visible, counts
--     against their standing, and tells the practitioner.
--
-- Enforced by a trigger, because "the client will only send the right fields"
-- is not a rule, it is a hope.

create or replace function enforce_listing_edit_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  moved boolean;
  booked integer;
begin
  moved := new.address_line is distinct from old.address_line
        or new.category is distinct from old.category
        or new.lat is distinct from old.lat
        or new.lng is distinct from old.lng;

  if moved then
    select count(*) into booked
    from bookings
    where space_id = old.id
      and status = 'upcoming'
      and starts_at > now();

    if booked > 0 then
      raise exception
        'This space has % upcoming %. Its address and room type cannot change until those sessions are done or cancelled.',
        booked, case when booked = 1 then 'session' else 'sessions' end
        using errcode = 'check_violation';
    end if;
  end if;

  /*
   * Back to pending, and the review state with it.
   *
   * Leaving the document verified while the address changes underneath it is
   * how a listing ends up live with a lease for somewhere else — the exact
   * thing the constraint in 0018 exists to make impossible, defeated by an
   * update that never touched the document column.
   */
  if moved or new.sublease_doc_path is distinct from old.sublease_doc_path then
    new.status := 'pending';
    new.sublease_doc_state := 'pending';
    new.sublease_doc_reviewed_at := null;
    new.doc_review_note := null;
  end if;

  if new.insurance_doc_path is distinct from old.insurance_doc_path then
    new.insurance_doc_state := 'pending';
    new.insurance_doc_reviewed_at := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists spaces_edit_rules on spaces;

/*
 * Only when a host is doing the editing.
 *
 * Staff approving a listing is an update too, and running these rules over it
 * would put the row straight back to pending the moment it was approved. The
 * service role has no auth.uid(), which is what separates the two.
 */
create trigger spaces_edit_rules
  before update on spaces
  for each row
  when (auth.uid() is not null)
  execute function enforce_listing_edit_rules();

-- ------------------------------------------------------------------
-- The columns a host may write at all.
--
-- The trigger decides what a change costs; this decides what is a change.
-- Status is absent on purpose — a host cannot approve their own listing, and
-- taking one down is a separate, deliberate action rather than a field on an
-- edit form.
-- ------------------------------------------------------------------
revoke update on spaces from authenticated;

grant update (
  name,
  category,
  hourly_rate_cents,
  capacity,
  access_type,
  entry_instructions,
  address_line,
  lat,
  lng,
  accessible,
  restroom,
  buffer_minutes,
  sublease_doc_path,
  insurance_doc_path,
  updated_at
) on spaces to authenticated;
