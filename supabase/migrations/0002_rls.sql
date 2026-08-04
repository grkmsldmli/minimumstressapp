-- Row Level Security
--
-- Two settings from the brief stay exactly as configured and this migration
-- does not touch them: RLS is enabled project-wide, and auto-expose-new-tables
-- stays off, so a table only becomes reachable once deliberately granted here.
--
-- The organising rule, because getting this wrong is how address_line leaks:
--
--   Base tables are owner-only. authenticated may reach its own rows;
--     anon may not reach them at all.
--   Anything public goes through a security *definer* view, whose safety comes
--     from its explicit column list and WHERE clause rather than from RLS.
--   Anything per-user goes through a security *invoker* view, so the caller's
--     own row policies still apply.
--
-- The distinction is load-bearing. An invoker view over a table the caller has
-- no grant on simply errors, so "public subset" views cannot be invoker; and a
-- definer view over per-user data bypasses RLS and would hand every
-- practitioner's balance to whoever asked, so per-user views cannot be definer.
--
-- Writes to bookings and credit_ledger happen server-side under the service
-- role, never from the client: a cancellation has to void or capture a Stripe
-- PaymentIntent and write a ledger row in one transaction, and RLS can gate who
-- writes a row but cannot make that write atomic with an external API call.

alter table profiles enable row level security;
alter table spaces enable row level security;
alter table space_media enable row level security;
alter table availability enable row level security;
alter table bookings enable row level security;
alter table credit_ledger enable row level security;

-- ------------------------------------------------------------------
-- Table privileges
--
-- Not redundant with the policies below: a policy narrows which rows a role
-- may touch, a GRANT decides whether it may touch the table at all. With
-- auto-expose off there are no defaults, so a policy without a matching grant
-- is dead code — the role is refused before RLS is ever consulted.
-- ------------------------------------------------------------------

grant select, insert, update on profiles to authenticated;
grant select, insert, update, delete on spaces to authenticated;
grant select, insert, update, delete on space_media to authenticated;
grant select, insert, update, delete on availability to authenticated;
grant select on bookings to authenticated;
grant select on credit_ledger to authenticated;

-- ------------------------------------------------------------------
-- profiles
-- ------------------------------------------------------------------

create policy "profiles: read own row"
  on profiles for select
  using (id = auth.uid());

create policy "profiles: insert own row"
  on profiles for insert
  with check (id = auth.uid());

create policy "profiles: update own row"
  on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ------------------------------------------------------------------
-- spaces — host-only at the table. Practitioners never select from it
-- directly; they read spaces_public, and the private fields come from
-- space_access_details() once they hold a booking.
-- ------------------------------------------------------------------

create policy "spaces: host reads own rows, any status"
  on spaces for select
  using (host_id = auth.uid());

create policy "spaces: host inserts own rows"
  on spaces for insert
  with check (host_id = auth.uid());

create policy "spaces: host updates own rows"
  on spaces for update
  using (host_id = auth.uid())
  with check (host_id = auth.uid());

create policy "spaces: host deletes own rows"
  on spaces for delete
  using (host_id = auth.uid());

-- ------------------------------------------------------------------
-- space_media / availability — host-only at the table, same as spaces.
-- Public reads go through the *_public views further down.
-- ------------------------------------------------------------------

create policy "space_media: host manages own space's media"
  on space_media for all
  using (exists (select 1 from spaces s where s.id = space_id and s.host_id = auth.uid()))
  with check (exists (select 1 from spaces s where s.id = space_id and s.host_id = auth.uid()));

create policy "availability: host manages own space's schedule"
  on availability for all
  using (exists (select 1 from spaces s where s.id = space_id and s.host_id = auth.uid()))
  with check (exists (select 1 from spaces s where s.id = space_id and s.host_id = auth.uid()));

-- ------------------------------------------------------------------
-- bookings / credit_ledger — read-only for the parties involved.
-- ------------------------------------------------------------------

create policy "bookings: practitioner reads own bookings"
  on bookings for select
  using (practitioner_id = auth.uid());

create policy "bookings: host reads bookings on own spaces"
  on bookings for select
  using (exists (select 1 from spaces s where s.id = space_id and s.host_id = auth.uid()));

create policy "credit_ledger: practitioner reads own entries"
  on credit_ledger for select
  using (practitioner_id = auth.uid());

-- ==================================================================
-- Public views — security DEFINER (the default).
--
-- Safety here is structural: the column list decides what exists at all, so
-- address_line, the Stripe identifiers and the document paths are not
-- omitted-but-reachable, they are absent. A future policy change cannot
-- widen them back into view.
-- ==================================================================

create or replace view spaces_public as
  select
    id, host_id, name, category, hourly_rate_cents, capacity, access_type,
    accessible, restroom, buffer_minutes, status, created_at
  from spaces
  where status = 'active';

grant select on spaces_public to anon, authenticated;

create or replace view public_host_profiles as
  select id, display_name, avatar_path
  from profiles;

grant select on public_host_profiles to anon, authenticated;

create or replace view availability_public as
  select a.id, a.space_id, a.weekday, a.start_minute, a.end_minute
  from availability a
  join spaces s on s.id = a.space_id
  where s.status = 'active';

grant select on availability_public to anon, authenticated;

create or replace view space_media_public as
  select m.id, m.space_id, m.storage_path, m.kind, m.position
  from space_media m
  join spaces s on s.id = m.space_id
  where s.status = 'active';

grant select on space_media_public to anon, authenticated;

-- ==================================================================
-- Per-user views — security INVOKER, so the caller's row policies apply.
-- ==================================================================

-- Without security_invoker this aggregate would sum the entire ledger and
-- hand every practitioner's balance to whoever queried it.
create or replace view credit_balances
  with (security_invoker = true) as
  select practitioner_id, coalesce(sum(delta_cents), 0)::integer as balance_cents
  from credit_ledger
  group by practitioner_id;

grant select on credit_balances to authenticated;

-- access_code itself is never selected here. The reveal is a server-side
-- timer flipping access_code_revealed_at; the raw value must not round-trip
-- to a client that is not yet entitled to it, even into a field the UI
-- happens not to render.
create or replace view bookings_with_access_code
  with (security_invoker = true) as
  select
    b.id, b.space_id, b.practitioner_id, b.starts_at, b.ends_at, b.status,
    b.is_instant, b.was_pro, b.host_rate_cents, b.service_fee_cents,
    b.instant_fee_cents, b.pro_discount_cents, b.credit_applied_cents,
    b.total_cents, b.platform_cents, b.captured_at, b.cancelled_at,
    b.cancelled_by, b.access_code_revealed_at, b.created_at,
    case
      when b.practitioner_id = auth.uid() and b.access_code_revealed_at <= now()
        then b.access_code
      else null
    end as revealed_access_code
  from bookings b;

grant select on bookings_with_access_code to authenticated;

-- ==================================================================
-- Address reveal — a security definer function, not a view.
--
-- A practitioner has no row policy on `spaces`, so an invoker view would
-- return nothing to exactly the person entitled to the address. Granting
-- them a row policy instead would expose every other column on the row,
-- including the host's sublease document path. A definer function is the
-- narrow instrument: it runs the ownership check itself and returns only the
-- five fields needed to walk into the room.
-- ==================================================================

create or replace function space_access_details(p_space_id uuid)
returns table (
  address_line text,
  lat double precision,
  lng double precision,
  entry_instructions text,
  access_type access_type
)
language sql
stable
security definer
set search_path = public
as $$
  select s.address_line, s.lat, s.lng, s.entry_instructions, s.access_type
  from spaces s
  where s.id = p_space_id
    and exists (
      select 1 from bookings b
      where b.space_id = s.id
        and b.practitioner_id = auth.uid()
        and b.status in ('upcoming', 'completed')
    );
$$;

revoke all on function space_access_details(uuid) from public;
grant execute on function space_access_details(uuid) to authenticated;
