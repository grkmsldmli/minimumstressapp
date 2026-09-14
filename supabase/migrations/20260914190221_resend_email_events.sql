-- Verified Resend delivery evidence for Command Center.
--
-- A row in `notifications` only proves that Resend accepted our API request.
-- It cannot prove that a recipient's mail server accepted the message, and one
-- message can later produce several provider events (delivered, then bounced or
-- complained). Keep those immutable facts separate and order them by Resend's
-- event timestamp because webhook delivery itself can be retried or arrive out
-- of order.
--
-- The payload, address, subject and provider error text are deliberately not
-- retained. Health needs only the event identity, message identity, outcome and
-- time; everything else would be unnecessary personal data.

create table if not exists resend_email_events (
  -- Stable across Resend/Svix retries, so replaying a signed request is a no-op.
  svix_id text primary key,
  resend_email_id text not null,
  event_type text not null check (
    event_type in (
      'email.delivered',
      'email.failed',
      'email.bounced',
      'email.complained'
    )
  ),
  event_created_at timestamptz not null,
  received_at timestamptz not null default now()
);

create index if not exists resend_email_events_email_created_idx
  on resend_email_events (resend_email_id, event_created_at desc, received_at desc);

-- A provider receipt is health evidence only when it belongs to a diagnostic
-- message this deployment sent. The fingerprint changes when the API key,
-- signing secret, or From address changes, forcing the new configuration to
-- prove itself instead of inheriting a green state from old credentials.
create table if not exists resend_email_probes (
  resend_email_id text primary key check (length(resend_email_id) between 1 and 200),
  configuration_sha256 text not null check (
    configuration_sha256 ~ '^[0-9a-f]{64}$'
  ),
  accepted_at timestamptz not null default now()
);

create index if not exists resend_email_probes_configuration_idx
  on resend_email_probes (configuration_sha256, accepted_at desc, resend_email_id);

-- Server-only, append-only evidence. RLS with no client policy plus the
-- explicit grants means browser roles cannot enumerate delivery activity, and
-- even the service role cannot rewrite or delete history through PostgREST.
alter table resend_email_events enable row level security;
alter table resend_email_probes enable row level security;
revoke all on table resend_email_events from public, anon, authenticated;
revoke all on table resend_email_probes from public, anon, authenticated;
-- Migration 0006 gives service_role full default table privileges. Narrow this
-- evidence ledger back down so even server code cannot rewrite history.
revoke all on table resend_email_events from service_role;
revoke all on table resend_email_probes from service_role;
grant select, insert on table resend_email_events to service_role;
grant select, insert on table resend_email_probes to service_role;
