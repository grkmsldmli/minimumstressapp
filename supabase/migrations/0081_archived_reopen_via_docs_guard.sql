-- Close a reopen hole in the listing-edit trigger.
--
-- 0078's enforce_listing_edit_rules guards against a host reopening a
-- staff-archived listing — but only inside `if new.status is distinct from
-- old.status`, i.e. when the client changes status directly (the "Show it
-- again" control). A host editing a *document* or the *address* never sends
-- status, so that block is skipped; execution then reaches the review-reset
-- rule, which forces `new.status := 'pending'` on a replaced sublease or a
-- move. The archived guard was already behind us, so an archived listing was
-- silently reopened — the exact thing the guard forbids, reached by a path it
-- did not cover.
--
-- This became reachable from the app when the edit screen gained a way to
-- re-upload a rejected sublease document; the address-move path could reach it
-- before that. The fix belongs in the trigger, which is the only boundary that
-- also covers a direct PostgREST write (sublease_doc_path has been column-
-- granted to hosts since 0019, and owner RLS gates only on host_id).
--
-- Redefine the function identically to 0078 but refuse the forced transition
-- to pending when the listing is archived. Staff actions run as service_role
-- (auth.uid() is null) and are unaffected — the trigger's WHEN clause already
-- limits it to browser-authenticated hosts.

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
  if new.status is distinct from old.status then
    if not (
      (old.status in ('active', 'pending') and new.status = 'delisted')
      or (old.status = 'delisted' and new.status = 'pending')
    ) then
      raise exception 'permission denied: that listing status change is not allowed. A host may hide a listing or send a hidden listing back for review.'
        using errcode = 'insufficient_privilege';
    end if;

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

  -- Moving the room or replacing the lease invalidates the prior review and
  -- sends the listing back to pending. If the listing was archived by staff,
  -- that forced transition would silently reopen a permanently-closed listing
  -- — the same reopen the status guard above refuses, reached here without the
  -- client ever setting status. Refuse it the same way.
  if moved or new.sublease_doc_path is distinct from old.sublease_doc_path then
    if old.archived_at is not null then
      raise exception 'permission denied: this listing is archived. Contact support to restore it.'
        using errcode = 'insufficient_privilege';
    end if;

    new.status := 'pending';
    new.sublease_doc_state := 'pending';
    new.sublease_doc_reviewed_at := null;
    new.doc_review_note := null;
    new.review_reason := array_to_string(reasons, ', ');

    if new.address_line is distinct from old.address_line then
      new.previous_address_line := old.address_line;
    end if;
  end if;

  if new.insurance_doc_path is distinct from old.insurance_doc_path then
    new.insurance_doc_state := 'pending';
    new.insurance_doc_reviewed_at := null;
  end if;

  if new.status = 'active' and old.status is distinct from 'active' then
    new.review_reason := null;
    new.previous_address_line := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;
