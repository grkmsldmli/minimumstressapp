-- What somebody searched for when there was nothing to find.
--
-- A marketplace with no inventory has one asset, and it is this. Every search
-- that comes back empty is a practitioner telling us the exact room they would
-- pay for and the exact town they would pay for it in — and thrown away, which
-- is what happens today, it is worth nothing. Kept, it is the difference
-- between telling a host "somebody might rent this" and telling them "eleven
-- people looked for a treatment room in San Mateo last month".
--
-- That is the flywheel: search, demand, host, inventory, booking. This is the
-- first turn of it, and it is the only part that works before there is
-- anything to book.
--
-- The table is deliberately small. Every column is a thing somebody has to be
-- asked for and a thing we then have to look after, and the two that matter
-- are what and where.

create table if not exists space_requests (
  id uuid primary key default gen_random_uuid(),
  -- A slug from src/lib/space-types.ts, or null for "any space". Constrained
  -- for the same reason spaces.suitable_for is: these become the labels on a
  -- demand page, and a typo would quietly split one town's demand in two.
  space_type text,
  -- Free text, because there is no list of towns to validate against until
  -- somebody has listed a room in one. Trimmed and capped by the endpoint.
  looking_in text not null,
  -- Optional, and the whole value exchange: we write when there is a room.
  -- Null is the normal case and the request still counts without it.
  email text,
  created_at timestamptz not null default now()
);

alter table space_requests drop constraint if exists space_requests_type_known;

alter table space_requests add constraint space_requests_type_known check (
  space_type is null or space_type = any (array[
    'pilates-studio',
    'yoga-studio',
    'movement-studio',
    'massage-room',
    'treatment-room',
    'acupuncture-room',
    'esthetician-room',
    'consultation-room',
    'meditation-room',
    'reiki-room'
  ])
);

alter table space_requests drop constraint if exists space_requests_looking_in_sane;

-- A town, not an essay. The endpoint caps it too; this is the floor under a
-- caller that goes around the endpoint.
alter table space_requests add constraint space_requests_looking_in_sane check (
  length(looking_in) between 1 and 80
);

create index if not exists space_requests_place_idx
  on space_requests (looking_in, space_type);

/*
 * Insert only, and read by nobody.
 *
 * This is the part to get right. The table holds "who is looking for what,
 * where, and here is their email" — a list that is useful to us and would be
 * a gift to anybody else, so the grant is INSERT and nothing else. There is no
 * select policy at all, which means even an authenticated account cannot read
 * a single row; the aggregate below is how the numbers get out, and it carries
 * no addresses.
 *
 * Anon can insert because the person doing it has no account and should not
 * need one — asking somebody to sign up before telling us what they were
 * looking for would collect almost nothing, which is the entire point of
 * having the table.
 */
alter table space_requests enable row level security;

grant insert on space_requests to anon, authenticated;
grant select on space_requests to service_role;

drop policy if exists "space_requests: anyone may say what they need" on space_requests;

create policy "space_requests: anyone may say what they need"
  on space_requests for insert
  with check (true);

/*
 * The numbers, without the people.
 *
 * What a host is shown — "4 people looked for a massage room here" — and what
 * a demand page would be built on. No email, no id, no timestamp finer than a
 * month: a count is persuasive and a list is a leak, and there is no version
 * of this that needs to be a list.
 *
 * Held back below three, for the same reason a city page is. One search is not
 * demand, it is one person, and quoting it to a host both overstates the case
 * and describes an individual more precisely than a count should.
 */
create or replace view space_demand
with (security_invoker = false) as
  select
    looking_in,
    space_type,
    count(*)::int as request_count,
    max(created_at) as last_asked_at
  from space_requests
  where created_at > now() - interval '90 days'
  group by looking_in, space_type
  having count(*) >= 3;

grant select on space_demand to anon, authenticated;
grant select on space_demand to service_role;
