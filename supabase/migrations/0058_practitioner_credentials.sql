-- Practitioner trust, part two: professional credentials, a booking
-- acknowledgment, and a credential signal for the host.
--
-- A credential is category-dependent (see lib/professions): a license is a
-- legal condition of booking for a regulated profession — massage therapy in
-- this set — and a booking is refused until staff verify one. For everyone
-- else a certificate is optional: it may be submitted and shown once reviewed,
-- and never blocks a booking. The columns hold one credential per practitioner,
-- mirroring how insurance already lives on `profiles`.
--
--   credential_type        what they say it is (e.g. "LMT", "RYT-200"). Text.
--   credential_jurisdiction the issuing state/authority, where one applies.
--   credential_number      the license/certificate number, where one applies.
--   credential_doc_path     the uploaded proof, in the same private bucket as
--                           insurance. The document never leaves that bucket and
--                           is never returned to a host.
--   credential_doc_state    null = none submitted; otherwise pending / verified
--                           / rejected. Set by staff, never the practitioner.
--   credential_doc_reviewed_at / credential_review_note   the staff verdict.

alter table profiles
  add column if not exists credential_type text,
  add column if not exists credential_jurisdiction text,
  add column if not exists credential_number text,
  add column if not exists credential_doc_path text,
  add column if not exists credential_doc_state doc_review_state,
  add column if not exists credential_doc_reviewed_at timestamptz,
  add column if not exists credential_review_note text;

-- A reviewed credential carries a time; an unreviewed or absent one does not.
alter table profiles
  drop constraint if exists profiles_credential_review_consistent;
alter table profiles
  add constraint profiles_credential_review_consistent check (
    (credential_doc_state in ('verified', 'rejected')) = (credential_doc_reviewed_at is not null)
  );

-- ------------------------------------------------------------------
-- Every verification verdict is the server's to set, never the account's.
--
-- RLS lets an account create and update its own profile row, so a practitioner
-- marking themselves identity-verified, insurance-verified, or credential-
-- reviewed has to be refused at the row — and on INSERT as much as UPDATE. The
-- profile row is created by the client (ensureProfile, and the role choice that
-- sets account_type), so a crafted first INSERT could otherwise set every
-- verdict at once and walk straight through the booking gate. This one guard
-- fires before insert and before update and covers all three domains.
--
-- 0057's identity trigger (update-only) is superseded by this and dropped below;
-- this migration is what closes the identity/insurance INSERT gap that shipped
-- before it. The insurance columns predate any trigger — this is their first.
--
-- What an account MAY still do: create its row, upload or replace its own
-- document (which restarts review), and enter allowed profession/credential
-- metadata. What it may never do is write a verdict. The service role — the
-- Stripe Identity webhook, the identity session route, the admin review route —
-- has no auth.uid() and is unaffected. `ins` reads OLD as NULL on INSERT via the
-- same case-guard the terms trigger (0020) uses, so the row's proposed values
-- are compared against an empty prior state.
-- ------------------------------------------------------------------
create or replace function enforce_profile_verdicts_server_only()
returns trigger
language plpgsql
as $$
declare
  ins boolean := tg_op = 'INSERT';
begin
  -- Service role (webhook, identity session route, admin review) sets the
  -- verdicts, and has no auth.uid(). Everything below guards the client alone.
  if auth.uid() is null then
    return new;
  end if;

  -- IDENTITY: the verified time and the session reference are server-only,
  -- always. There is no client-writable path here at all.
  if new.identity_verified_at is distinct from (case when ins then null else old.identity_verified_at end)
     or new.identity_session_id is distinct from (case when ins then null else old.identity_session_id end) then
    raise exception 'identity verification is set by the server, not the client'
      using errcode = 'check_violation';
  end if;

  -- INSURANCE: uploading or replacing the certificate restarts review and wipes
  -- any prior verdict; with no new certificate the verdict fields are staff-only.
  -- The default state is 'pending', so a fresh row that never set it is fine.
  if new.insurance_doc_path is distinct from (case when ins then null else old.insurance_doc_path end) then
    new.insurance_doc_state := 'pending';
    new.insurance_doc_reviewed_at := null;
    new.insurance_effective_date := null;
    new.insurance_expires_at := null;
    new.insurance_insurer := null;
    new.insurance_policy_number := null;
    new.insurance_review_note := null;
  elsif new.insurance_doc_state
          is distinct from coalesce(case when ins then null else old.insurance_doc_state end, 'pending')
     or new.insurance_doc_reviewed_at is distinct from (case when ins then null else old.insurance_doc_reviewed_at end)
     or new.insurance_effective_date is distinct from (case when ins then null else old.insurance_effective_date end)
     or new.insurance_expires_at is distinct from (case when ins then null else old.insurance_expires_at end)
     or new.insurance_insurer is distinct from (case when ins then null else old.insurance_insurer end)
     or new.insurance_policy_number is distinct from (case when ins then null else old.insurance_policy_number end)
     or new.insurance_review_note is distinct from (case when ins then null else old.insurance_review_note end) then
    raise exception 'insurance review is set by staff, not the practitioner'
      using errcode = 'check_violation';
  end if;

  -- CREDENTIAL: same shape as insurance. State is nullable (null = none), so a
  -- fresh row with no credential is fine; a new document restarts review.
  if new.credential_doc_path is distinct from (case when ins then null else old.credential_doc_path end) then
    new.credential_doc_state :=
      case when new.credential_doc_path is null then null else 'pending' end;
    new.credential_doc_reviewed_at := null;
    new.credential_review_note := null;
  elsif new.credential_doc_state is distinct from (case when ins then null else old.credential_doc_state end)
     or new.credential_doc_reviewed_at is distinct from (case when ins then null else old.credential_doc_reviewed_at end)
     or new.credential_review_note is distinct from (case when ins then null else old.credential_review_note end) then
    raise exception 'credential review is set by staff, not the practitioner'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- The identity-only trigger from 0057 is subsumed by the guard above.
drop trigger if exists profiles_identity_server_only on profiles;
drop trigger if exists profiles_credential_review_server_only on profiles;
drop trigger if exists profiles_verdicts_server_only on profiles;
create trigger profiles_verdicts_server_only
  before insert or update on profiles
  for each row
  execute function enforce_profile_verdicts_server_only();

-- ------------------------------------------------------------------
-- The booking carries the acknowledgment it was made under.
--
-- The declaration screen states, at the point of booking, that the space will
-- be used only for the declared purpose and under the space and platform rules.
-- Booking is the agreement; this records the moment it was given, so a later
-- dispute can point to it alongside the purpose already stored on the row.
-- Stamped by the server at creation, never by the client.
-- ------------------------------------------------------------------
alter table bookings
  add column if not exists rules_ack_at timestamptz;

-- ------------------------------------------------------------------
-- The host's trust summary gains one signal: a reviewed credential.
--
-- Both functions are redefined to add practitioner_credential_reviewed — true
-- only when a credential has actually been verified. Never the document, the
-- number, the jurisdiction, or the review note; only the plain fact that one
-- was reviewed. The rest is exactly 0057.
-- ------------------------------------------------------------------
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
  attendee_count integer,
  practitioner_profession text,
  practitioner_identity_verified boolean,
  practitioner_insurance_verified boolean,
  practitioner_credential_reviewed boolean,
  practitioner_completed_sessions integer,
  practitioner_good_standing boolean
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
    b.host_rate_cents,
    p.display_name,
    p.avatar_path,
    b.purpose,
    b.purpose_note,
    b.attendee_count,
    p.profession,
    p.identity_verified_at is not null,
    p.insurance_doc_state = 'verified',
    p.credential_doc_state = 'verified',
    (
      select count(*)::integer
      from bookings cb
      where cb.practitioner_id = b.practitioner_id
        and cb.status = 'completed'
        and cb.captured_at is not null
    ),
    (
      select count(*)
      from bookings lc
      where lc.practitioner_id = b.practitioner_id
        and lc.cancelled_by = 'practitioner'
        and lc.captured_at is not null
        and lc.cancelled_at > now() - interval '90 days'
        and lc.starts_at - lc.cancelled_at < interval '24 hours'
    ) < 2
  from bookings b
  join spaces s on s.id = b.space_id
  join profiles p on p.id = b.practitioner_id
  where s.host_id = auth.uid()
    and b.approval_state = 'pending'
    and b.status = 'upcoming'
    and b.authorized_at is not null
  order by b.starts_at;
$$;

revoke all on function host_requests() from public;
grant execute on function host_requests() to authenticated;

drop function if exists host_bookings();

create function host_bookings()
returns table (
  booking_id uuid,
  space_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  status booking_status,
  net_cents integer,
  practitioner_name text,
  practitioner_avatar_path text,
  host_paid_at timestamptz,
  practitioner_profession text,
  practitioner_identity_verified boolean,
  practitioner_insurance_verified boolean,
  practitioner_credential_reviewed boolean,
  practitioner_completed_sessions integer,
  practitioner_good_standing boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id,
    b.space_id,
    b.starts_at,
    b.ends_at,
    b.status,
    b.host_rate_cents,
    p.display_name,
    p.avatar_path,
    b.host_paid_at,
    p.profession,
    p.identity_verified_at is not null,
    p.insurance_doc_state = 'verified',
    p.credential_doc_state = 'verified',
    (
      select count(*)::integer
      from bookings cb
      where cb.practitioner_id = b.practitioner_id
        and cb.status = 'completed'
        and cb.captured_at is not null
    ),
    (
      select count(*)
      from bookings lc
      where lc.practitioner_id = b.practitioner_id
        and lc.cancelled_by = 'practitioner'
        and lc.captured_at is not null
        and lc.cancelled_at > now() - interval '90 days'
        and lc.starts_at - lc.cancelled_at < interval '24 hours'
    ) < 2
  from bookings b
  join spaces s on s.id = b.space_id
  join profiles p on p.id = b.practitioner_id
  where s.host_id = auth.uid()
    and b.captured_at is not null
  order by b.starts_at;
$$;

revoke all on function host_bookings() from public;
grant execute on function host_bookings() to authenticated;
