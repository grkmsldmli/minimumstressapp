-- Host listing lifecycle: hide and ask to relist without granting self-approval.
--
-- 0019 deliberately removed blanket UPDATE on spaces and granted editable
-- columns one by one. That was correct for review-controlled fields, but the
-- app's separate "Hide it / Show it again" control later tried to update
-- `status` directly. Because `status` was never granted, PostgREST rejected the
-- action with "permission denied for table spaces" before RLS even ran.
--
-- Give an authenticated host UPDATE privilege on status, but keep the review
-- boundary in the existing listing-edit trigger:
--   active/pending -> delisted   host hides or withdraws the listing
--   delisted       -> pending    host asks to show it again; staff re-approves
--   anything       -> active     never allowed from a client
-- Owner RLS still limits the row to the signed-in host.
--
-- IMPORTANT: this function intentionally carries forward the review provenance
-- added in 0040 (review_reason / previous_address_line). Replacing the trigger
-- with the older 0019 body would silently erase the operator's reason-for-review
-- trail whenever a host edits an address, room type, pin or lease.

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
  -- Status is a separate lifecycle control, not a free-form editable field.
  -- This trigger runs only for browser-authenticated hosts (the trigger's WHEN
  -- clause is auth.uid() is not null), so service-role admin actions are not
  -- constrained by this host-only state machine.
  if new.status is distinct from old.status then
    if not (
      (old.status in ('active', 'pending') and new.status = 'delisted')
      or (old.status = 'delisted' and new.status = 'pending')
    ) then
      -- Keep "permission denied" in the message because callers and existing
      -- regression tests treat self-approval as an authorization failure.
      raise exception 'permission denied: that listing status change is not allowed. A host may hide a listing or send a hidden listing back for review.'
        using errcode = 'insufficient_privilege';
    end if;

    -- archived_at is an operator state layered on top of delisted. A host must
    -- not silently reopen a listing staff deliberately archived.
    if old.archived_at is not null and new.status = 'pending' then
      raise exception 'permission denied: this listing is archived. Contact support to restore it.'
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

  -- Preserve 0040's operator-facing explanation of what sent the listing back
  -- to review. Coordinates are intentionally described as an address change.
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

  -- Moving the room or replacing the lease invalidates the prior review.
  if moved or new.sublease_doc_path is distinct from old.sublease_doc_path then
    new.status := 'pending';
    new.sublease_doc_state := 'pending';
    new.sublease_doc_reviewed_at := null;
    new.doc_review_note := null;
    new.review_reason := array_to_string(reasons, ', ');

    if new.address_line is distinct from old.address_line then
      new.previous_address_line := old.address_line;
    end if;
  end if;

  -- Preserve the original insurance-document re-review rule from 0019. 0040
  -- extended the same trigger for review provenance; it did not change the
  -- business meaning of replacing a space-insurance document.
  if new.insurance_doc_path is distinct from old.insurance_doc_path then
    new.insurance_doc_state := 'pending';
    new.insurance_doc_reviewed_at := null;
  end if;

  -- Clear review provenance if an authenticated path ever returns a row live.
  -- Normal staff approval uses service_role and also clears these fields in the
  -- admin action itself; this keeps the trigger internally complete.
  if new.status = 'active' and old.status is distinct from 'active' then
    new.review_reason := null;
    new.previous_address_line := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- Owner UPDATE RLS remains in force. This is only column privilege; the trigger
-- above constrains the allowed transitions and prevents host self-approval.
grant update (status) on spaces to authenticated;
