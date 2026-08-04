-- Minimum Stress Spaces — core schema
--
-- Not yet applied to a live project. Written against the data model in the
-- Phase 1 plan; run `supabase db push` (or paste into the SQL editor) once
-- Supabase keys are available, then read it back with `supabase db diff` to
-- confirm nothing drifted before trusting it in production.
--
-- Money columns mirror src/lib/money.ts's BookingMoney type field-for-field,
-- because a booking freezes the quote that produced it — a host raising their
-- rate later must never rewrite what a past booking cost.

-- No pgcrypto extension: gen_random_uuid() has been core Postgres since 13 and
-- Supabase runs 15+, so requiring the extension would only narrow where these
-- migrations can run.

-- Every statement in this file is safe to re-run. Postgres has no
-- `create type if not exists`, hence the wrapper; tables and indexes use the
-- built-in guard.
--
-- This matters more than it looks. Applying the full script to a project that
-- already has most of it should be boring, not a transaction that aborts on
-- line 16 and leaves the reader guessing which half landed.
do $$ begin
  create type space_category as enum ('physical', 'traditional', 'social', 'spirit');
exception when duplicate_object then null; end $$;

do $$ begin
  create type access_type as enum ('keypad', 'lockbox', 'greeter');
exception when duplicate_object then null; end $$;

do $$ begin
  create type restroom_option as enum ('private', 'shared', 'none');
exception when duplicate_object then null; end $$;

do $$ begin
  create type space_status as enum ('pending', 'active', 'delisted');
exception when duplicate_object then null; end $$;

do $$ begin
  create type media_kind as enum ('image', 'video');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payout_schedule as enum ('standard', 'instant');
exception when duplicate_object then null; end $$;

do $$ begin
  create type booking_status as enum (
    'upcoming', 'completed', 'cancelled_by_practitioner', 'cancelled_by_host', 'no_show'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type cancelled_by_actor as enum ('practitioner', 'host');
exception when duplicate_object then null; end $$;

do $$ begin
  create type credit_reason as enum ('host_cancellation', 'booking_redemption', 'goodwill_restore');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------------
-- profiles
--
-- One row per auth.users row. No "role" column: the brief's Role Select
-- screen ("You can switch anytime from the top of either screen") is a UI
-- entry point, not a database-enforced identity — the same person can host a
-- space and book someone else's on the same account.
-- ------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_path text,
  is_pro boolean not null default false,
  pro_since timestamptz,
  stripe_customer_id text unique,
  stripe_connect_account_id text unique,
  stripe_connect_charges_enabled boolean not null default false,
  insurance_doc_path text,
  payout_schedule payout_schedule not null default 'standard',
  notify_bookings boolean not null default true,
  notify_payouts boolean not null default true,
  notify_offers boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- spaces
--
-- room_type is not stored: it is a pure function of category
-- (lib/taxonomy.ts roomTypeFor), so there is exactly one place the two can
-- ever disagree — the lookup table — rather than a column that can drift
-- from it.
--
-- address_line / lat / lng / entry_instructions are private until a
-- practitioner has a confirmed booking on this space. See 0002_rls.sql for
-- how that boundary is actually enforced — column *visibility* rather than
-- a client-side check, so the private fields never leave the server for an
-- unauthorized request in the first place.
-- ------------------------------------------------------------------
create table if not exists spaces (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references profiles (id) on delete cascade,
  name text not null,
  category space_category not null,
  hourly_rate_cents integer not null check (hourly_rate_cents > 0),
  capacity integer not null check (capacity > 0),
  access_type access_type not null,
  entry_instructions text not null,
  address_line text not null,
  lat double precision,
  lng double precision,
  accessible boolean,
  restroom restroom_option,
  buffer_minutes integer not null default 0 check (buffer_minutes >= 0),
  status space_status not null default 'pending',
  sublease_doc_path text not null,
  insurance_doc_path text,
  legal_ack_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists spaces_host_id_idx on spaces (host_id);
create index if not exists spaces_status_idx on spaces (status) where status = 'active';

-- ------------------------------------------------------------------
-- space_media
--
-- The brief requires at least one photo or video per listing but never
-- gates step 1 or 2 on anything past that, so this table has no NOT NULL
-- constraint tying it to a minimum count — that rule lives in application
-- validation at submission time, where it can produce a helpful error
-- instead of a database exception.
-- ------------------------------------------------------------------
create table if not exists space_media (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces (id) on delete cascade,
  storage_path text not null,
  kind media_kind not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists space_media_space_id_idx on space_media (space_id, position);

-- ------------------------------------------------------------------
-- availability
--
-- One row per block, not one row per day. This is what lets a single Monday
-- hold 7-8am, 2-3pm and 5-9pm as three independent rows rather than forcing
-- one start/end pair per weekday.
-- ------------------------------------------------------------------
create table if not exists availability (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_minute smallint not null check (start_minute between 0 and 1439),
  end_minute smallint not null check (end_minute between 1 and 1440),
  constraint availability_ordered check (end_minute > start_minute)
);

create index if not exists availability_space_id_idx on availability (space_id, weekday);

-- ------------------------------------------------------------------
-- bookings
--
-- Every money column is frozen at creation from a src/lib/money.ts Quote —
-- never recomputed from the space's current rate. access_code is generated
-- but withheld from API responses until access_code_revealed_at (target:
-- T-30min), enforced server-side, not by hiding it in the client.
-- ------------------------------------------------------------------
-- on delete restrict, deliberately: a booking is a financial record tied to a
-- Stripe PaymentIntent and possibly a credit_ledger entry. Cascading a space
-- or profile deletion into it would silently destroy the audit trail for money
-- that actually moved. Deleting either has to reckon with its bookings first.
create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces (id) on delete restrict,
  practitioner_id uuid not null references profiles (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status booking_status not null default 'upcoming',
  is_instant boolean not null,
  was_pro boolean not null,

  -- Frozen quote — see src/lib/money.ts BookingMoney.
  host_rate_cents integer not null,
  service_fee_cents integer not null,
  instant_fee_cents integer not null,
  pro_discount_cents integer not null,
  credit_applied_cents integer not null,
  total_cents integer not null,
  platform_cents integer not null,

  stripe_payment_intent_id text unique,
  authorized_at timestamptz,
  captured_at timestamptz,

  cancelled_at timestamptz,
  cancelled_by cancelled_by_actor,

  access_code text,
  access_code_revealed_at timestamptz,

  created_at timestamptz not null default now(),

  constraint bookings_ordered check (ends_at > starts_at),
  constraint bookings_cancellation_consistent check (
    (cancelled_at is null) = (cancelled_by is null)
  )
);

create index if not exists bookings_practitioner_id_idx on bookings (practitioner_id);
create index if not exists bookings_space_id_idx on bookings (space_id);
create index if not exists bookings_starts_at_idx on bookings (starts_at) where status = 'upcoming';

-- ------------------------------------------------------------------
-- credit_ledger
--
-- Append-only. The balance is never a stored number — it is always
-- SUM(delta_cents), matching lib/money.ts's creditBalance(). A mutable
-- balance column next to this table would be exactly the bug the prototype
-- had, where credits.balance and credits.ledger could drift apart.
-- ------------------------------------------------------------------
create table if not exists credit_ledger (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references profiles (id) on delete restrict,
  delta_cents integer not null,
  reason credit_reason not null,
  booking_id uuid references bookings (id) on delete restrict,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists credit_ledger_practitioner_id_idx on credit_ledger (practitioner_id);

-- security_invoker is load-bearing here, not decoration: without it this
-- view runs as its owner (typically the migration role) and RLS on
-- credit_ledger never applies, so every practitioner's balance becomes
-- readable by anyone granted select on the view. With it, the view enforces
-- exactly the same row policies the base table does for the querying user.
create or replace view credit_balances
  with (security_invoker = true) as
  select practitioner_id, coalesce(sum(delta_cents), 0)::integer as balance_cents
  from credit_ledger
  group by practitioner_id;
