-- Raw product-usage events are kept for 90 days by the authenticated cron
-- route, then removed. Make that one destructive capability explicit while
-- keeping the internal stream closed to every client role.
--
-- 0073 intentionally named only SELECT/INSERT for service_role but Supabase's
-- default table grants still left broader privileges in place. Reset them here
-- to the exact three operations the server now performs: ingest, report, prune.

revoke all on table public.analytics_events from anon, authenticated, service_role;
grant select, insert, delete on table public.analytics_events to service_role;

alter table public.analytics_events enable row level security;
