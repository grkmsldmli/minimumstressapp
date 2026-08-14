-- Why a listing is waiting, recorded at the moment it starts waiting.
--
-- 0019 sends a listing back to pending when its address, its coordinates, its
-- room type or its sublease document change, and the trigger knows exactly
-- which of those it was — `moved` is computed from four comparisons. It then
-- threw that away and wrote `status := 'pending'`, so the queue showed a card
-- with a name, a rate and an address and no way to tell what the operator was
-- being asked to look at.
--
-- The screen guesses at it today: a listing updated more than an hour after it
-- was created is labelled "back for review" rather than "new". That is a good
-- guess about *whether* something changed and says nothing about *what*, which
-- is the only part that decides where to look. A studio that moved across town
-- needs its new address checked against a lease; a studio that changed its room
-- type does not.
--
-- So the trigger writes it down. Two columns, both set where the decision is
-- already being made:
--
--   review_reason         which fields sent it back, comma separated
--   previous_address_line where it was, when the address is what moved
--
-- The previous address is the one piece of history worth keeping, because the
-- reviewer's question is a comparison: is this the same building described
-- differently, or a different building entirely? Nothing else here needs a
-- before — a room type is a short list and the document is attached.
--
-- Cleared on approval rather than left to go stale: the reason belongs to the
-- review it was raised for, and a listing live for a month should not still be
-- carrying the note from the last time it moved.

alter table spaces
  add column if not exists review_reason text,
  add column if not exists previous_address_line text;

create or replace function enforce_listing_edit_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  moved boolean;
  booked integer;
  reasons text[] := '{}';
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
   * What changed, in the words the queue prints.
   *
   * Coordinates are folded into "address": a host dragging the pin has moved
   * the room, and telling an operator "lat changed" asks them to care about a
   * number instead of a place.
   */
  if new.address_line is distinct from old.address_line
     or new.lat is distinct from old.lat
     or new.lng is distinct from old.lng then
    reasons := array_append(reasons, 'address');
  end if;

  if new.category is distinct from old.category then
    reasons := array_append(reasons, 'room type');
  end if;

  if new.sublease_doc_path is distinct from old.sublease_doc_path then
    reasons := array_append(reasons, 'sublease document');
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
    new.review_reason := array_to_string(reasons, ', ');

    -- Only when the street itself moved. Overwriting this on a room-type edit
    -- would leave the operator comparing an address against itself.
    if new.address_line is distinct from old.address_line then
      new.previous_address_line := old.address_line;
    end if;
  end if;

  /*
   * The note belongs to the review it was raised for. Staff approving is an
   * update by the service role, which the trigger does not run for, so this
   * clears on the way back to live rather than being left to go stale.
   */
  if new.status = 'active' and old.status is distinct from 'active' then
    new.review_reason := null;
    new.previous_address_line := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

/*
 * Staff read these, hosts do not write them. They are absent from the grant in
 * 0019 on purpose: a host who could set their own review_reason could describe
 * a move as a typo.
 */
