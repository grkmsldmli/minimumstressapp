-- Work becomes a coverage job board, and hosts get Studio Pro.
--
-- Purely additive on top of 0069 (which is applied to production and must never
-- be edited): new nullable/defaulted columns, one new table, and a server-only
-- guard. Every existing work_preferences / work_availability / class_templates /
-- work_requests / work_interest row stays valid and readable — no column is
-- altered, no constraint on existing data is tightened.
--
-- Two things ship here:
--   1. Studio Pro — a host-account subscription (profiles.studio_pro), the
--      host-side mirror of practitioner is_pro. Written ONLY by the Stripe
--      webhook; a client can never set it (trigger below). The Founding-Host
--      free six months and lifetime 50% are NOT stored — they are derived from
--      founding_host_at in lib/entitlements, so nothing to migrate for them.
--   2. Richer coverage listings — session format (group / private / semiprivate /
--      workshop), level, participant counts, required vs preferred qualifications,
--      and private-session context — plus My Roster.

-- ------------------------------------------------------------------
-- Studio Pro entitlement columns on profiles (webhook-written only).
-- ------------------------------------------------------------------
alter table profiles
  add column if not exists studio_pro boolean not null default false,
  add column if not exists studio_pro_since timestamptz,
  add column if not exists studio_pro_current_period_end timestamptz,
  add column if not exists studio_pro_cancel_at_period_end boolean not null default false;

-- studio_pro is the server's to set (via the Stripe webhook), never the client's
-- — the same discipline as identity/insurance/founding, which is_pro never got a
-- DB guard for. Mirrors enforce_identity_server_only (0057).
create or replace function enforce_studio_pro_server_only()
returns trigger
language plpgsql
as $$
declare
  ins boolean := tg_op = 'INSERT';
begin
  if auth.uid() is not null
     and new.studio_pro is distinct from (case when ins then false else old.studio_pro end) then
    raise exception 'studio pro is set by the server, not the client'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_studio_pro_server_only on profiles;
create trigger profiles_studio_pro_server_only
  before insert or update on profiles
  for each row execute function enforce_studio_pro_server_only();

-- ------------------------------------------------------------------
-- Richer coverage listings — additive columns on work_requests.
--
-- session_format tells a practitioner what kind of session it is; the other
-- fields carry the teaching/session context the board and the applicant decision
-- need. required_/preferred_ are separate arrays so a preference can never become
-- a hidden hard filter — the board is browse-all and the practitioner decides.
-- Private-session context (goal/experience/accommodations/programming) lives here
-- too, but the safe-preview serialization (lib/work-service) is what decides what
-- ever reaches the board — no client identity is exposed by these columns alone.
-- ------------------------------------------------------------------
alter table work_requests
  add column if not exists session_format text,
  add column if not exists level text,
  add column if not exists participants_expected integer,
  add column if not exists participants_max integer,
  add column if not exists audience text,
  add column if not exists teaching_notes text,
  add column if not exists equipment_notes text,
  add column if not exists required_qualifications text[] not null default '{}',
  add column if not exists preferred_qualifications text[] not null default '{}',
  add column if not exists session_goal text,
  add column if not exists client_experience text,
  add column if not exists accommodations text,
  add column if not exists programming text;

alter table work_requests
  drop constraint if exists work_requests_session_format_known;
alter table work_requests
  add constraint work_requests_session_format_known check (
    session_format is null
    or session_format in ('group', 'private', 'semiprivate', 'workshop')
  );
alter table work_requests
  drop constraint if exists work_requests_programming_known;
alter table work_requests
  add constraint work_requests_programming_known check (
    programming is null or programming in ('continue', 'studio', 'design')
  );
alter table work_requests
  drop constraint if exists work_requests_participants_sane;
alter table work_requests
  add constraint work_requests_participants_sane check (
    (participants_expected is null or participants_expected >= 0)
    and (participants_max is null or participants_max >= 1)
  );

-- Same descriptors on the reusable template, so a request can snapshot them.
alter table class_templates
  add column if not exists session_format text,
  add column if not exists participants_expected integer,
  add column if not exists audience text,
  add column if not exists teaching_notes text,
  add column if not exists required_qualifications text[] not null default '{}',
  add column if not exists preferred_qualifications text[] not null default '{}',
  add column if not exists default_pay_cents integer,
  add column if not exists session_goal text,
  add column if not exists client_experience text,
  add column if not exists accommodations text,
  add column if not exists programming text;

alter table class_templates
  drop constraint if exists class_templates_session_format_known;
alter table class_templates
  add constraint class_templates_session_format_known check (
    session_format is null
    or session_format in ('group', 'private', 'semiprivate', 'workshop')
  );
alter table class_templates
  drop constraint if exists class_templates_default_pay_sane;
alter table class_templates
  add constraint class_templates_default_pay_sane check (
    default_pay_cents is null or default_pay_cents >= 0
  );

-- ------------------------------------------------------------------
-- My Roster — a studio's own trusted substitute network.
--
-- Host-curated: after a real confirmed/completed relationship a host may keep a
-- practitioner here and invite them to future coverage. Being on a roster NEVER
-- means automatic assignment — an invite is a notification; the practitioner
-- still applies and is confirmed the normal way. "Times worked together" is
-- derived from filled requests at read time, not stored, so it cannot drift.
-- ------------------------------------------------------------------
create table if not exists work_roster (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references profiles (id) on delete cascade,
  practitioner_id uuid not null references profiles (id) on delete cascade,
  note text,
  added_at timestamptz not null default now(),
  constraint work_roster_unique unique (host_id, practitioner_id)
);

create index if not exists work_roster_host_idx on work_roster (host_id, added_at desc);

alter table work_roster enable row level security;
grant select, insert, update, delete on work_roster to authenticated;
grant select, insert, update, delete on work_roster to service_role;

-- The host manages their own roster and reads only their own. A practitioner has
-- no read here — they learn of an invite through a notification, not by seeing
-- which studios saved them (which would be a back-channel into who works where).
drop policy if exists "work_roster: host reads own" on work_roster;
create policy "work_roster: host reads own"
  on work_roster for select
  using (host_id = auth.uid());

drop policy if exists "work_roster: only hosts add to own" on work_roster;
create policy "work_roster: only hosts add to own"
  on work_roster for insert
  with check (
    host_id = auth.uid()
    and exists (select 1 from profiles p where p.id = auth.uid() and p.account_type = 'host')
  );

drop policy if exists "work_roster: host updates own" on work_roster;
create policy "work_roster: host updates own"
  on work_roster for update
  using (host_id = auth.uid())
  with check (host_id = auth.uid());

drop policy if exists "work_roster: host removes own" on work_roster;
create policy "work_roster: host removes own"
  on work_roster for delete
  using (host_id = auth.uid());
