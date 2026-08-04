-- Two-sided reviews, safety escalation, and emergency contacts.
--
-- Three things that only make sense together: a way for each side to say what
-- happened, a way for the bad ones to reach a person, and a way to reach
-- somebody if a session goes wrong while it is happening.
--
-- The rules themselves live in src/lib/reviews.ts and are tested there. What is
-- here is what the database must guarantee no matter what any client believes:
-- one review per side per booking, ratings inside 1..5, and a review that
-- cannot be written by anyone who was not in the room.

do $$
begin
  create type reviewer_role as enum ('practitioner', 'host');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type escalation_priority as enum ('safety', 'urgent', 'review');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type escalation_state as enum ('open', 'acknowledged', 'resolved');
exception
  when duplicate_object then null;
end $$;

-- ------------------------------------------------------------------
-- reviews
--
-- The sub-answers are nullable because the two roles ask different questions:
-- a practitioner is asked about access and cleanliness, a host about how the
-- room was left. Splitting into two tables would duplicate every rule about
-- visibility and escalation for the sake of a few empty columns.
-- ------------------------------------------------------------------
create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings (id) on delete cascade,
  -- Denormalised from the booking so a policy can check authorship without
  -- joining, and so a review survives as evidence of who wrote it.
  author_id uuid not null references profiles (id) on delete cascade,
  subject_id uuid not null references profiles (id) on delete cascade,
  role reviewer_role not null,

  overall smallint not null check (overall between 1 and 5),
  comment text not null default '',

  -- Ticked independently of the stars. A five-star session can still end with
  -- an unlocked fire door, and tying escalation only to a low rating loses
  -- exactly those reports.
  safety_concern boolean not null default false,

  -- Practitioner answers about the space.
  access_on_time boolean,
  cleanliness smallint check (cleanliness between 1 and 5),
  accuracy smallint check (accuracy between 1 and 5),
  would_book_again boolean,

  -- Host answers about the practitioner.
  left_as_found smallint check (left_as_found between 1 and 5),
  respected_house_rules boolean,
  on_time boolean,
  would_host_again boolean,

  created_at timestamptz not null default now(),

  -- One per side per booking. This is the constraint that makes the blind
  -- period meaningful: without it, a second review could be written after
  -- reading the counterpart.
  constraint reviews_one_per_side unique (booking_id, role),

  -- Nobody reviews themselves.
  constraint reviews_two_parties check (author_id <> subject_id)
);

create index if not exists reviews_subject_idx on reviews (subject_id, created_at desc);
create index if not exists reviews_booking_idx on reviews (booking_id);

-- ------------------------------------------------------------------
-- review_escalations
--
-- A separate row rather than a flag on the review, because what staff need to
-- track is the handling, not the rating: when it was seen, by whom, what was
-- decided. Written by the server when a qualifying review arrives.
-- ------------------------------------------------------------------
create table if not exists review_escalations (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null unique references reviews (id) on delete cascade,
  priority escalation_priority not null,
  state escalation_state not null default 'open',
  note text,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz
);

create index if not exists review_escalations_open_idx
  on review_escalations (priority, created_at)
  where state <> 'resolved';

-- ------------------------------------------------------------------
-- Emergency contacts
--
-- Somebody to call if a session goes wrong while it is happening. Stored on
-- the profile and readable by nobody but the owner and staff — the counterpart
-- in a booking never sees it, in either direction. A practitioner alone in a
-- stranger's building and a host letting a stranger into theirs have the same
-- need and the same right to privacy about it.
-- ------------------------------------------------------------------
alter table profiles
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_phone text,
  add column if not exists emergency_contact_relationship text;

do $$
begin
  alter table profiles add constraint profiles_emergency_phone_is_e164
    check (emergency_contact_phone is null or emergency_contact_phone ~ '^\+[1-9][0-9]{6,14}$');
exception
  when duplicate_object then null;
end $$;

-- ------------------------------------------------------------------
-- Access
--
-- Reviews are written through a server route, never inserted from the client:
-- eligibility depends on the session having ended and on there being no
-- earlier review, and both are checks a client can be made to skip. So there
-- is no insert policy at all — the service role writes them.
--
-- Reading is the part clients do, and it is narrow: you may read a review you
-- wrote, and a review about you once it is visible. "Visible" is not a column
-- a client can be trusted to filter on, so it is computed here.
-- ------------------------------------------------------------------
alter table reviews enable row level security;
alter table review_escalations enable row level security;

-- Dropped by name and table together, so re-running this file replaces its own
-- policies rather than colliding with them.
do $$
declare existing record;
begin
  for existing in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in ('reviews', 'review_escalations')
  loop
    execute format('drop policy if exists %I on public.%I', existing.policyname, existing.tablename);
  end loop;
end $$;

create policy "reviews: author reads own"
  on reviews for select
  using (author_id = auth.uid());

grant select on reviews to authenticated;
grant select, insert, update on reviews to service_role;
grant select, insert, update on review_escalations to service_role;

-- ------------------------------------------------------------------
-- public_reviews
--
-- What a listing shows. Security definer, and its safety is the column list:
-- the author's identity, the booking it came from and the safety flag are all
-- absent, so a host cannot work out which practitioner left three stars and
-- act on it.
--
-- Only released reviews appear. A review is released when its counterpart
-- exists, or when the blind period has run out — the same rule as
-- src/lib/reviews.ts, enforced here because this is the only copy a client
-- cannot bypass.
-- ------------------------------------------------------------------
drop view if exists public_reviews;

create view public_reviews
with (security_invoker = false) as
  select
    r.id,
    r.subject_id,
    b.space_id,
    r.role,
    r.overall,
    r.comment,
    r.created_at
  from reviews r
  join bookings b on b.id = r.booking_id
  where
    exists (
      select 1 from reviews other
      where other.booking_id = r.booking_id and other.role <> r.role
    )
    or r.created_at + interval '14 days' <= now();

grant select on public_reviews to anon, authenticated;
grant select on public_reviews to service_role;

-- ------------------------------------------------------------------
-- space_ratings
--
-- The aggregate a listing card shows. Counted from released reviews only, so
-- a sealed one cannot be inferred by watching the number move.
--
-- The average is returned raw; the decision to withhold it under three
-- reviews belongs to src/lib/reviews.ts, which is where the reason for that
-- rule is written down.
-- ------------------------------------------------------------------
drop view if exists space_ratings;

create view space_ratings
with (security_invoker = false) as
  select
    space_id,
    count(*)::int as review_count,
    avg(overall)::numeric(3, 2) as average_rating
  from public_reviews
  where role = 'practitioner'
  group by space_id;

grant select on space_ratings to anon, authenticated;
grant select on space_ratings to service_role;
