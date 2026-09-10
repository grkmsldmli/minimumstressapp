-- Work — practitioners open themselves to coverage, studios ask for it.
--
-- The marketplace's second unit. Spaces let a practitioner rent a room; Work
-- lets a studio that is short a teacher find one, and a practitioner who wants
-- more hours be found. It reuses everything already true about a person: the
-- same profile, the same profession, the same three verification verdicts that
-- gate booking (identity 0057, insurance 0054, credential 0058). A practitioner
-- who is not yet allowed to book is not yet matchable here either — the gate is
-- read, never re-invented.
--
-- Five tables, one job each:
--   work_preferences   one row per practitioner — the "available for work"
--                      switch, their radius, pay floor, and the wall-clock zone
--                      their availability is written in. Off by default.
--   work_availability  the practitioner's recurring weekly windows, the exact
--                      shape of `availability` (0001) but keyed to a person.
--   class_templates    a studio's reusable class — Reformer Flow, 50 min, max 8
--                      — so a coverage request is a few taps, not a form.
--   work_requests      one "need coverage" post, with an explicit lifecycle.
--   work_interest      a practitioner saying "I can take that", and the studio's
--                      answer. At most one is ever confirmed per request.
--
-- Money is offered pay in integer cents, like everywhere else. This migration
-- charges nothing and moves nothing: Work is free in this release, and the
-- studio-subscription that will later meter it is a boundary drawn cleanly (a
-- host either may post or may not), not a fee wired in here.

-- ------------------------------------------------------------------
-- Enums — DB-internal state machines.
-- ------------------------------------------------------------------
do $$ begin
  create type work_request_state as enum (
    'draft', 'open', 'filled', 'completed', 'cancelled', 'expired'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type work_interest_state as enum (
    'interested', 'confirmed', 'declined', 'withdrawn'
  );
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------------
-- work_preferences — the practitioner's Work opt-in and settings.
--
-- One row per practitioner, created the first time they open Work. The switch
-- is off until they turn it on, and turning it off takes them out of every
-- future match immediately (matching reads available_for_work). Existing
-- interest and confirmed shifts are untouched — a preference is not a
-- cancellation.
--
--   work_timezone   the wall-clock zone their weekly availability is written in.
--                   Required because a 9am block is meaningless without a wall
--                   (the 0029 lesson). Region form only — bare "EST" is refused,
--                   because Intl silently mis-resolves it (see lib/timezone).
--   base_lat/_lng   an optional home point for distance ranking. Private: read
--                   only server-side by matching, never returned to another
--                   user, and only a coarse label ever reaches a studio.
--   max_travel_miles / min_pay_cents  soft preferences a practitioner sets; a
--                   request outside them is ranked down or filtered, never a
--                   hard error.
-- ------------------------------------------------------------------
create table if not exists work_preferences (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null unique references profiles (id) on delete cascade,

  available_for_work boolean not null default false,

  -- Wall-clock zone for work_availability. Defaults to the platform zone; the
  -- client sends the viewer's own zone on first save.
  work_timezone text not null default 'America/Los_Angeles',

  -- Optional home point for distance ranking. Both set together or both null.
  base_lat double precision,
  base_lng double precision,
  -- What they typed, kept for display; never sent to a geocoder from here.
  base_postcode text,

  max_travel_miles integer check (max_travel_miles is null or max_travel_miles between 1 and 500),
  min_pay_cents integer check (min_pay_cents is null or min_pay_cents >= 0),

  open_to_onetime boolean not null default true,
  open_to_recurring boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint work_preferences_zone_region_form
    check (work_timezone ~ '^[A-Za-z][A-Za-z0-9+_-]*(/[A-Za-z0-9+_.-]+)+$'),
  constraint work_preferences_point_paired
    check ((base_lat is null) = (base_lng is null))
);

-- ------------------------------------------------------------------
-- work_availability — the practitioner's recurring weekly windows.
--
-- Field-for-field the shape of `availability` (0001), keyed to a practitioner
-- rather than a space. One row per block; a day holds any number. Minutes are
-- wall-clock in work_preferences.work_timezone.
-- ------------------------------------------------------------------
create table if not exists work_availability (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references profiles (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_minute smallint not null check (start_minute between 0 and 1439),
  end_minute smallint not null check (end_minute between 1 and 1440),
  constraint work_availability_ordered check (end_minute > start_minute)
);

create index if not exists work_availability_practitioner_idx
  on work_availability (practitioner_id, weekday);

-- ------------------------------------------------------------------
-- class_templates — a studio's reusable class definition.
--
-- So "need coverage" is picking a class, not re-describing one. Owned by a host,
-- edited freely, archived rather than deleted (a past request may still name
-- it). profession is the matching axis — the kind of professional who can cover
-- it — mirrored to lib/professions like profiles.profession (0057).
-- ------------------------------------------------------------------
create table if not exists class_templates (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references profiles (id) on delete cascade,

  title text not null,
  -- The professional who can cover it. Null means "any professional".
  profession text,
  -- Free-text descriptors a teacher reads, never matched on.
  level text,
  equipment text,
  duration_minutes integer not null default 60 check (duration_minutes between 15 and 480),
  max_participants integer check (max_participants is null or max_participants between 1 and 200),
  notes text,
  arrival_notes text,
  -- A class that legally needs a verified credential to cover (e.g. hands-on).
  -- Every practitioner already carries one to book, so this is belt-and-braces.
  requires_credential boolean not null default false,

  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint class_templates_profession_known check (
    profession is null or profession in (
      'pilates', 'yoga', 'movement', 'massage', 'holistic', 'meditation', 'coaching', 'other'
    )
  )
);

create index if not exists class_templates_host_idx
  on class_templates (host_id) where archived_at is null;

-- ------------------------------------------------------------------
-- work_requests — one "need coverage" post, with a lifecycle.
--
-- States: draft (being written) -> open (accepting interest) -> filled (a
-- practitioner confirmed). A request can be cancelled by the host from draft or
-- open. expired and completed are time-derived in the app (open past its start
-- is expired; filled past its end is completed) and stored only if a job ever
-- writes them — the enum carries them so that later transition is not a schema
-- change. filled_interest_id / filled_at are written ONLY by
-- confirm_work_interest (below); the client never sets them.
--
-- title / profession / time_zone are denormalised from the template and space
-- at post time so the request survives the template being archived or the room
-- being edited — a booking freezes its own money for the same reason (0001).
-- ------------------------------------------------------------------
create table if not exists work_requests (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references profiles (id) on delete cascade,
  -- Where it happens, and what it is. Both optional links kept loose (set null)
  -- so archiving a template or delisting a room never deletes a live request.
  class_template_id uuid references class_templates (id) on delete set null,
  space_id uuid references spaces (id) on delete set null,

  title text not null,
  profession text,

  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- The room's wall-clock zone, carried so the time reads the way the host meant
  -- it wherever a practitioner sees it (the 0029/booking lesson).
  time_zone text not null,

  pay_cents integer not null check (pay_cents >= 0),
  notes text,
  urgent boolean not null default false,

  state work_request_state not null default 'draft',
  -- Server-written by confirm_work_interest only.
  filled_interest_id uuid,
  filled_at timestamptz,
  cancelled_at timestamptz,
  -- Defaults to the start; a request unanswered by then is treated as expired.
  expires_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint work_requests_ordered check (ends_at > starts_at),
  constraint work_requests_fill_consistent check (
    (state = 'filled') = (filled_interest_id is not null and filled_at is not null)
  ),
  constraint work_requests_cancel_consistent check (
    (state = 'cancelled') = (cancelled_at is not null)
  ),
  constraint work_requests_profession_known check (
    profession is null or profession in (
      'pilates', 'yoga', 'movement', 'massage', 'holistic', 'meditation', 'coaching', 'other'
    )
  ),
  constraint work_requests_zone_region_form
    check (time_zone ~ '^[A-Za-z][A-Za-z0-9+_-]*(/[A-Za-z0-9+_.-]+)+$')
);

create index if not exists work_requests_host_idx
  on work_requests (host_id, created_at desc);
-- The matcher's hot query: open requests still ahead of now.
create index if not exists work_requests_open_idx
  on work_requests (starts_at) where state = 'open';

-- ------------------------------------------------------------------
-- work_interest — a practitioner offering to cover, and the answer.
--
-- One row per (request, practitioner). state moves interested -> confirmed |
-- declined, or the practitioner withdraws. At most one confirmed per request,
-- guaranteed by a partial unique index and by confirm_work_interest doing the
-- whole transition in one transaction.
-- ------------------------------------------------------------------
create table if not exists work_interest (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references work_requests (id) on delete cascade,
  practitioner_id uuid not null references profiles (id) on delete cascade,

  state work_interest_state not null default 'interested',
  message text,

  created_at timestamptz not null default now(),
  decided_at timestamptz,

  constraint work_interest_unique unique (request_id, practitioner_id)
);

create index if not exists work_interest_request_idx
  on work_interest (request_id, created_at);
-- At most one confirmed practitioner per request — the schema-level backstop
-- behind confirm_work_interest, so a double-fill is impossible even if the
-- transaction logic were bypassed.
create unique index if not exists work_interest_one_confirmed_per_request
  on work_interest (request_id) where state = 'confirmed';

-- The circular link, added once both tables exist: which interest filled the
-- request. Loose FK (set null) so declining/deleting an interest never orphans.
alter table work_requests
  drop constraint if exists work_requests_filled_interest_fk;
alter table work_requests
  add constraint work_requests_filled_interest_fk
  foreign key (filled_interest_id) references work_interest (id) on delete set null;

-- ------------------------------------------------------------------
-- Row-level security.
--
-- The two owner tables (preferences, availability) are the practitioner's own
-- to read and write. class_templates are the host's own. work_requests and
-- work_interest are readable by the parties they concern but NEVER writable from
-- the browser: posting a request matches and notifies, expressing interest and
-- confirming enforce eligibility and atomicity — all the route's job on the
-- service key, so an insert policy would be a second copy of those rules
-- drifting in another language (the 0033/0034 reasoning).
-- ------------------------------------------------------------------

-- work_preferences: the practitioner manages their own row.
alter table work_preferences enable row level security;
grant select, insert, update on work_preferences to authenticated;
grant select, insert, update on work_preferences to service_role;

drop policy if exists "work_preferences: practitioner reads own" on work_preferences;
create policy "work_preferences: practitioner reads own"
  on work_preferences for select
  using (practitioner_id = auth.uid());

drop policy if exists "work_preferences: only practitioners create own" on work_preferences;
create policy "work_preferences: only practitioners create own"
  on work_preferences for insert
  with check (
    practitioner_id = auth.uid()
    and exists (select 1 from profiles p where p.id = auth.uid() and p.account_type = 'practitioner')
  );

drop policy if exists "work_preferences: practitioner updates own" on work_preferences;
create policy "work_preferences: practitioner updates own"
  on work_preferences for update
  using (practitioner_id = auth.uid())
  with check (practitioner_id = auth.uid());

-- work_availability: the practitioner manages their own blocks.
alter table work_availability enable row level security;
grant select, insert, update, delete on work_availability to authenticated;
grant select, insert, update, delete on work_availability to service_role;

drop policy if exists "work_availability: practitioner reads own" on work_availability;
create policy "work_availability: practitioner reads own"
  on work_availability for select
  using (practitioner_id = auth.uid());

drop policy if exists "work_availability: only practitioners create own" on work_availability;
create policy "work_availability: only practitioners create own"
  on work_availability for insert
  with check (
    practitioner_id = auth.uid()
    and exists (select 1 from profiles p where p.id = auth.uid() and p.account_type = 'practitioner')
  );

drop policy if exists "work_availability: practitioner updates own" on work_availability;
create policy "work_availability: practitioner updates own"
  on work_availability for update
  using (practitioner_id = auth.uid())
  with check (practitioner_id = auth.uid());

drop policy if exists "work_availability: practitioner deletes own" on work_availability;
create policy "work_availability: practitioner deletes own"
  on work_availability for delete
  using (practitioner_id = auth.uid());

-- class_templates: the host manages their own templates.
alter table class_templates enable row level security;
grant select, insert, update, delete on class_templates to authenticated;
grant select, insert, update, delete on class_templates to service_role;

drop policy if exists "class_templates: host reads own" on class_templates;
create policy "class_templates: host reads own"
  on class_templates for select
  using (host_id = auth.uid());

drop policy if exists "class_templates: only hosts create own" on class_templates;
create policy "class_templates: only hosts create own"
  on class_templates for insert
  with check (
    host_id = auth.uid()
    and exists (select 1 from profiles p where p.id = auth.uid() and p.account_type = 'host')
  );

drop policy if exists "class_templates: host updates own" on class_templates;
create policy "class_templates: host updates own"
  on class_templates for update
  using (host_id = auth.uid())
  with check (host_id = auth.uid());

drop policy if exists "class_templates: host deletes own" on class_templates;
create policy "class_templates: host deletes own"
  on class_templates for delete
  using (host_id = auth.uid());

-- work_requests: the host reads their own; nobody writes from the browser.
-- Practitioners never read the table directly — the matcher hands them safe
-- previews server-side, so an open request never leaks its host or full detail
-- to the whole marketplace.
alter table work_requests enable row level security;
grant select on work_requests to authenticated;
grant select, insert, update on work_requests to service_role;

drop policy if exists "work_requests: host reads own" on work_requests;
create policy "work_requests: host reads own"
  on work_requests for select
  using (host_id = auth.uid());

-- work_interest: the practitioner reads their own; the host reads interest on
-- the requests they own — through the request, never by practitioner id, so a
-- host cannot enumerate one person's whole history (the 0033 reasoning).
alter table work_interest enable row level security;
grant select on work_interest to authenticated;
grant select, insert, update on work_interest to service_role;

drop policy if exists "work_interest: practitioner reads own" on work_interest;
create policy "work_interest: practitioner reads own"
  on work_interest for select
  using (practitioner_id = auth.uid());

drop policy if exists "work_interest: host reads interest on own requests" on work_interest;
create policy "work_interest: host reads interest on own requests"
  on work_interest for select
  using (
    exists (
      select 1 from work_requests r
      where r.id = work_interest.request_id and r.host_id = auth.uid()
    )
  );

-- ------------------------------------------------------------------
-- confirm_work_interest — the studio picks one, atomically.
--
-- The crux of the whole feature: one practitioner is confirmed, everyone else
-- on the request is declined, and the request flips to filled — all in one
-- transaction, so two studios (or two clicks) racing the same request can never
-- both win. The request row is locked FOR UPDATE (the instrument, like the
-- advisory lock in award_founding_host), and every write is guarded on the
-- state it expects, so a second attempt matches nothing and changes nothing.
--
-- Ownership is NOT checked here: this runs on the service role (auth.uid() is
-- null on that path), and the calling route verifies the host owns the request
-- before calling — the same discipline every admin-path write follows. Returns
-- the confirmed interest id, or null when nothing was confirmed (already filled,
-- expired, or a stale pick), so the route can tell the studio which happened.
-- ------------------------------------------------------------------
create or replace function confirm_work_interest(p_request_id uuid, p_interest_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state work_request_state;
  v_starts timestamptz;
begin
  select state, starts_at into v_state, v_starts
    from work_requests where id = p_request_id
    for update;

  if v_state is null then return null; end if;          -- unknown request
  if v_state <> 'open' then return null; end if;         -- already filled/cancelled/draft
  if v_starts <= now() then return null; end if;         -- effectively expired

  -- The chosen interest must belong to this request and still be live.
  update work_interest
    set state = 'confirmed', decided_at = now()
    where id = p_interest_id and request_id = p_request_id and state = 'interested';
  if not found then return null; end if;                 -- stale pick: leave request open

  update work_requests
    set state = 'filled', filled_interest_id = p_interest_id, filled_at = now(),
        updated_at = now()
    where id = p_request_id and state = 'open';

  -- Everyone else waiting on this request is declined in the same transaction.
  update work_interest
    set state = 'declined', decided_at = now()
    where request_id = p_request_id and id <> p_interest_id and state = 'interested';

  return p_interest_id;
end;
$$;

revoke all on function confirm_work_interest(uuid, uuid) from public;
grant execute on function confirm_work_interest(uuid, uuid) to service_role;
