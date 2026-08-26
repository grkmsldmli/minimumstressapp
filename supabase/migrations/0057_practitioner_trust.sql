-- Practitioner trust, part one: identity, profession, and what a host may see.
--
-- Three things arrive together because they answer one question — "who is
-- booking my room, and can I trust them" — and share a home on `profiles`.
--
--   identity_verified_at   set only by the Stripe Identity webhook (service
--                          role). Null means not verified; the booking gate
--                          refuses. A client can never write it — see the
--                          trigger below.
--   identity_session_id    the Stripe VerificationSession, so a return can be
--                          matched and a session reused. Minimum reference, no
--                          documents; those never leave Stripe.
--   profession             one of a small controlled set (see lib/professions),
--                          display only for now. Constrained so a client cannot
--                          store a value a later credential rule can't read.
--
-- Nothing is backfilled. Existing practitioners have identity_verified_at null,
-- which is exactly right: they verify once, next time they book. Bookings
-- already on the calendar are untouched — the gate only guards *new* bookings.

alter table profiles
  add column if not exists identity_verified_at timestamptz,
  add column if not exists identity_session_id text,
  add column if not exists profession text;

-- The controlled set, mirrored from lib/professions PROFESSION_KEYS. A client
-- write outside it is refused rather than stored and shown as a broken label.
alter table profiles
  drop constraint if exists profiles_profession_known;
alter table profiles
  add constraint profiles_profession_known check (
    profession is null or profession in (
      'pilates', 'yoga', 'movement', 'massage', 'holistic',
      'meditation', 'coaching', 'other'
    )
  );

-- ------------------------------------------------------------------
-- Identity state is the server's to set, never the practitioner's.
--
-- RLS lets an account update its own profile row (display name, profession,
-- notification prefs). Identity must sit outside that: a practitioner marking
-- themselves verified is the one thing this whole feature exists to prevent. So
-- any change to the two identity columns by a signed-in caller (auth.uid() is
-- their id) is refused; the service role — the Identity webhook and the session
-- route — has no auth.uid() and passes. This mirrors how host payability is
-- only ever flipped by Stripe's webhook, never by the client.
-- ------------------------------------------------------------------
create or replace function enforce_identity_server_only()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null
     and (
       new.identity_verified_at is distinct from old.identity_verified_at
       or new.identity_session_id is distinct from old.identity_session_id
     ) then
    raise exception 'identity verification is set by the server, not the client'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_identity_server_only on profiles;
create trigger profiles_identity_server_only
  before update on profiles
  for each row
  execute function enforce_identity_server_only();

-- ------------------------------------------------------------------
-- The trust summary a host reads before approving — and on their history.
--
-- Added to the two functions the host already calls, so no new round trip and
-- no cross-user read from the client: both are security definer, so they can
-- join the practitioner's profile and count their sessions while returning only
-- a coarse summary. Never a document, a policy number, a date of birth, contact
-- detail, or another host's booking — just five plain signals.
--
-- `good_standing` is the SQL of standingFor()'s "clear" level: fewer than
-- THRESHOLDS.practitioner.warnAt (2) qualifying late cancellations in
-- STANDING_WINDOW_DAYS (90). "Qualifying" and "late" are reliability.ts's own
-- rule — a captured booking the practitioner cancelled inside the
-- 24-hour window (FREE_CANCEL_WINDOW). A suspended practitioner never reaches a
-- host (the booking gate stops them); this line lets a host see the ordinary
-- good case plainly and stays silent about a borderline one by simply being
-- false.
--
-- This is the one place the Standing rule is expressed in SQL rather than by
-- calling standingFor(), which Postgres cannot. standing-sql-sync.test.ts pins
-- the three numbers below to reliability.ts so the two copies cannot drift
-- silently; full centralisation waits for a rework of the host data flow.
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
