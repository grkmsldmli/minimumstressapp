-- Admin operating system: a first-party analytics event stream and a durable
-- admin audit log. Both are INTERNAL, server-only datasets — written and read
-- only by the service role (the admin console and server-derived emitters). No
-- client, practitioner, or host ever reads or writes them.
--
-- The access model mirrors `notifications` (0009) and `founding_hosts` (0060):
-- RLS on, an explicit `revoke all from anon, authenticated` as belt-and-suspenders
-- over the default deny, an explicit `grant select, insert to service_role`, and
-- NO policies at all — the service role bypasses RLS, everyone else is denied.
-- Purely additive and re-runnable (create-if-not-exists throughout); no earlier
-- migration is touched.

-- ------------------------------------------------------------------
-- analytics_events — a first-party product event stream.
--
-- Server-derived for anything that is a business fact (payments, subscriptions,
-- bookings) so the founder dashboard never trusts the client for money or state.
-- `properties` is a small jsonb bag; emitters must never write secrets, message
-- contents, medical information, or payment credentials into it (enforced in
-- lib/analytics before the row is built).
-- ------------------------------------------------------------------
create table if not exists analytics_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  event_name text not null,
  user_id uuid references profiles (id) on delete set null,
  anonymous_id text,
  session_id text,
  platform text,
  app_version text,
  surface text,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- The dashboard's hot queries: recent events, and counts/funnels by event name
-- over a window; plus per-user event history on a profile page.
create index if not exists analytics_events_occurred_idx on analytics_events (occurred_at desc);
create index if not exists analytics_events_name_idx on analytics_events (event_name, occurred_at desc);
create index if not exists analytics_events_user_idx on analytics_events (user_id, occurred_at desc);

alter table analytics_events enable row level security;
revoke all on analytics_events from anon, authenticated;
grant select, insert on analytics_events to service_role;

-- ------------------------------------------------------------------
-- admin_audit_log — every state-changing admin action, durably recorded.
--
-- "Never silently mutate production data without an audit trail." Written after
-- a staff decision succeeds, attributed to the acting staff account. Metadata is
-- safe, human-readable context only (never documents, secrets, or PII beyond the
-- target id and a staff-typed reason).
-- ------------------------------------------------------------------
create table if not exists admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  -- Nullable + no cascade: the log outlives the account it refers to, and an
  -- action taken by staff should never vanish because a row elsewhere changed.
  admin_user_id uuid,
  admin_email text,
  action text not null,
  target_type text,
  target_id text,
  reason text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists admin_audit_log_occurred_idx on admin_audit_log (occurred_at desc);
create index if not exists admin_audit_log_target_idx on admin_audit_log (target_type, target_id);
create index if not exists admin_audit_log_admin_idx on admin_audit_log (admin_user_id, occurred_at desc);

alter table admin_audit_log enable row level security;
revoke all on admin_audit_log from anon, authenticated;
grant select, insert on admin_audit_log to service_role;
