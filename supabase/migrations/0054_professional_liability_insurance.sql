-- Liability insurance for the professionals who book.
--
-- profiles.insurance_doc_path already held a practitioner's uploaded
-- certificate, but nothing more: no review state, no validity dates. A file on
-- disk is not proof of active cover, and booking a space for professional use
-- now turns on that proof. This adds the record of *reviewing* it and of *when
-- it is valid*, mirroring the space-document review 0018 gave hosts.
--
-- Additive and backward compatible. Every existing profile keeps its path and
-- gets state 'pending' — an uploaded certificate is awaiting review, never
-- auto-verified, because auto-approving cover nobody checked is the one thing
-- this record exists to prevent. Nothing is deleted and no booking is touched.

alter table profiles
  add column if not exists insurance_doc_state doc_review_state not null default 'pending',
  add column if not exists insurance_doc_reviewed_at timestamptz,
  -- The policy window. Both are required once a certificate is verified; a
  -- verified certificate with no dates cannot answer "is it valid on the
  -- booking date?", which is the whole question the booking gate asks.
  add column if not exists insurance_effective_date date,
  add column if not exists insurance_expires_at date,
  -- What staff read off the certificate. Deliberately minimal — enough to
  -- identify the policy, not to build a profile of the person.
  add column if not exists insurance_insurer text,
  add column if not exists insurance_policy_number text,
  -- Shown to the professional verbatim when a certificate is turned down, the
  -- same way a listing's doc_review_note reaches a host. Cleared on the next
  -- verification. (Mirrors spaces.doc_review_note from 0018.)
  add column if not exists insurance_review_note text;

-- A review moment exists exactly when the state is no longer the default.
-- (The same shape as spaces_insurance_review_consistent in 0018.)
alter table profiles
  drop constraint if exists profiles_insurance_review_consistent;
alter table profiles
  add constraint profiles_insurance_review_consistent check (
    (insurance_doc_state = 'pending') = (insurance_doc_reviewed_at is null)
  );

-- Verified means the window is known. A verified certificate must carry both
-- dates, and the expiry cannot precede the start. This is what lets the booking
-- gate trust a 'verified' state without re-checking that the dates make sense.
alter table profiles
  drop constraint if exists profiles_insurance_dates_when_verified;
alter table profiles
  add constraint profiles_insurance_dates_when_verified check (
    insurance_doc_state <> 'verified'
    or (
      insurance_effective_date is not null
      and insurance_expires_at is not null
      and insurance_expires_at >= insurance_effective_date
    )
  );
