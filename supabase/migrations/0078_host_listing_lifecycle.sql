-- Host listing lifecycle: hide and ask to relist without granting self-approval.
--
-- 0019 deliberately removed blanket UPDATE on spaces and granted editable
-- columns one by one. That was correct for review-controlled fields, but the
-- app's separate "Hide it / Show it again" control later tried to update
-- `status` directly. Because `status` was never granted, PostgREST rejected the
-- action with "permission denied for table spaces" before RLS even ran.
--
-- Give an authenticated host UPDATE privilege on status, but keep the review
-- boundary in the database trigger:
--   active/pending -> delisted   host hides or withdraws the listing
--   delisted       -> pending    host asks to show it again; staff re-approves
--   anything       -> active     never allowed from a client
-- Owner RLS still limits the row to the signed-in host.

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
  -- Status is a separate lifecycle control, not a free-form editable field.
  -- A host may take their own listing down and may ask for a hidden listing to
  -- return to review, but may never make a listing active themselves.
  if new.status is distinct from old.status then
    if not (
      (old.status in ('active', 'pending') and new.status = 'delisted')
      or (old.status = 'delisted' and new.status = 'pending')
    ) then
      raise exception 'That listing status change is not allowed. A host may hide a listing or send a hidden listing back for review.'
        using errcode = 'insufficient_privilege';
    end if;

    -- Archived is an operator state layered on top of delisted. A host cannot
    -- silently reopen an archived listing; staff has to restore it deliberately.
    if old.archived_at is not null and new.status = 'pending' then
      raise exception 'This listing is archived. Contact support to restore it.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

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

  -- Moving the room or replacing the lease invalidates the prior review.
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

grant update (status) on spaces to authenticated;
