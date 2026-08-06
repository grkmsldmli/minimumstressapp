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
