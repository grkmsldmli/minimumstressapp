-- What happened to the file a host uploaded.
--
-- A host hands over their lease — the document that proves they are allowed to
-- sublet at all — and then the app goes quiet. The listing says "pending", and
-- pending covers everything: not looked at yet, looked at and fine, looked at
-- and unreadable. There was no way to tell which, and no way to find out
-- except to wait and see whether the listing went live.
--
-- That is the wrong side of the asymmetry. We are holding somebody's lease and
-- their insurance certificate, and they are the one who cannot see what became
-- of it.
--
-- Recorded per document rather than per listing, because the two do not move
-- together: insurance is optional and can be missing while the sublease is
-- fine, and a rejected insurance certificate should not read as a rejected
-- listing.

do $$ begin
  create type doc_review_state as enum ('pending', 'verified', 'rejected');
exception when duplicate_object then null;
end $$;

alter table spaces
  add column if not exists sublease_doc_state doc_review_state not null default 'pending',
  add column if not exists sublease_doc_reviewed_at timestamptz,
  add column if not exists insurance_doc_state doc_review_state not null default 'pending',
  add column if not exists insurance_doc_reviewed_at timestamptz,
  -- Shown to the host verbatim when something is rejected. Written by staff,
  -- so a rejection can say "the second page is cut off" rather than "rejected".
  add column if not exists doc_review_note text;

-- ------------------------------------------------------------------
-- A state and a timestamp that cannot disagree.
--
-- "Verified" with no date is a claim with nothing behind it, and a date on
-- something still pending is a review that did not happen. Either both or
-- neither, enforced here rather than remembered at each call site.
-- ------------------------------------------------------------------
alter table spaces
  drop constraint if exists spaces_sublease_review_consistent;
alter table spaces
  add constraint spaces_sublease_review_consistent check (
    (sublease_doc_state = 'pending') = (sublease_doc_reviewed_at is null)
  );

alter table spaces
  drop constraint if exists spaces_insurance_review_consistent;
alter table spaces
  add constraint spaces_insurance_review_consistent check (
    (insurance_doc_state = 'pending') = (insurance_doc_reviewed_at is null)
  );

-- ------------------------------------------------------------------
-- Existing listings, recorded before the rule is imposed.
--
-- The constraint below used to sit above this block, and adding a check
-- validates every row already in the table — so it was judging listings that
-- were live and correct against a column that had only just been created and
-- still said 'pending' for all of them. It failed on the first real database
-- it met, having passed every test, because the test database had no rows in
-- it yet.
--
-- Anything already live was reviewed by a person before it was switched on,
-- so it is recorded as verified rather than dropped back into a queue that
-- would ask them to prove it twice. Pending ones stay pending, which is what
-- they are.
-- ------------------------------------------------------------------
update spaces
set sublease_doc_state = 'verified',
    sublease_doc_reviewed_at = coalesce(updated_at, created_at)
where status = 'active'
  and sublease_doc_state = 'pending';

update spaces
set insurance_doc_state = 'verified',
    insurance_doc_reviewed_at = coalesce(updated_at, created_at)
where status = 'active'
  and insurance_doc_path is not null
  and insurance_doc_state = 'pending';

-- ------------------------------------------------------------------
-- A live listing has a verified lease behind it.
--
-- 0010 already refuses an active listing with no sublease document. This is
-- the same rule one step further on: having the file is not the same as
-- having read it, and "active" is the app telling practitioners this room is
-- legitimately available.
-- ------------------------------------------------------------------
alter table spaces
  drop constraint if exists spaces_active_requires_verified_lease;
alter table spaces
  add constraint spaces_active_requires_verified_lease check (
    status <> 'active' or sublease_doc_state = 'verified'
  );
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
-- Who agreed to what, and when.
--
-- The terms existed and nobody had accepted them. A host acknowledged
-- something per listing — `spaces.legal_ack_at`, which covers the sublease
-- declaration for that one room — and a practitioner accepted nothing at all.
-- So the rule that matters most commercially, that a session arranged off the
-- app is between the two people who arranged it, was written down where
-- neither of them had ever agreed to it.
--
-- "It was in the terms" is worth little without a record of the moment it was
-- shown and taken. This is that record: one row per account, the version they
-- accepted, and the time.
--
-- Versioned rather than a boolean, because the terms will change. A boolean
-- says somebody once agreed to something; a version says what. When the text
-- changes materially the constant in the app moves, and everyone is asked
-- again — which is the only honest way to keep the record true.

alter table profiles
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version integer;

-- Both or neither. A version with no timestamp is a claim with no moment
-- behind it, and a timestamp with no version is a moment with no text.
alter table profiles
  drop constraint if exists profiles_terms_consistent;
alter table profiles
  add constraint profiles_terms_consistent check (
    (terms_accepted_at is null) = (terms_version is null)
  );

-- ------------------------------------------------------------------
-- Write-once per version, and never backdated.
--
-- Acceptance is a fact about a past moment. A client that could set the
-- timestamp would be able to say somebody agreed last year, and one that could
-- lower the version would be able to un-accept a change they had already been
-- shown. Both are decided here rather than trusted to the caller.
-- ------------------------------------------------------------------
create or replace function enforce_terms_acceptance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  was integer := case when tg_op = 'UPDATE' then old.terms_version else null end;
begin
  /*
   * Insert as well as update, because the client upserts.
   *
   * The app writes a profile with `on conflict do update`, and Postgres checks
   * the proposed tuple before the conflict is resolved. A trigger that only
   * fired on UPDATE therefore never ran: the version arrived without a
   * timestamp, and the constraint below — the one insisting the two agree —
   * rejected it. Both paths, so acceptance is recorded however it arrives.
   */
  if new.terms_version is distinct from was
     or (tg_op = 'UPDATE' and new.terms_accepted_at is distinct from old.terms_accepted_at) then

    if new.terms_version is null then
      if was is null then
        return new;
      end if;
      raise exception 'Accepted terms cannot be withdrawn.'
        using errcode = 'check_violation';
    end if;

    if was is not null and new.terms_version < was then
      raise exception 'Terms version cannot go backwards.'
        using errcode = 'check_violation';
    end if;

    -- The clock is the server's, whatever the client sent.
    new.terms_accepted_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_terms_acceptance on profiles;

create trigger profiles_terms_acceptance
  before insert or update on profiles
  for each row
  when (auth.uid() is not null)
  execute function enforce_terms_acceptance();

-- ------------------------------------------------------------------
-- Existing accounts.
--
-- Left null on purpose. Backfilling would record an acceptance that never
-- happened, which is worse than having none — it is the one field whose whole
-- value is that it is true. They are asked next time they open the app.
-- ------------------------------------------------------------------
