-- Give service_role access to the tables the server actually writes.
--
-- This was missing, and the failure mode was thoroughly misleading: the secret
-- key authenticated fine — Storage answered 200 with it — while every REST call
-- came back denied. It read like a bad key. It was a missing GRANT.
--
-- The same lesson as 0002: BYPASSRLS lets a role ignore row policies, it does
-- not let it touch a table it has no privilege on. Stock Supabase hides this by
-- granting service_role everything through default privileges; with
-- auto-expose-new-tables off there are no defaults, so nothing is granted until
-- it is written down here.
--
-- Safe because the secret key never reaches a browser: src/lib/supabase/env.ts
-- throws if it is read client-side, and src/lib/stripe/client.ts and the server
-- helpers are marked server-only.
--
-- Full access rather than a narrow list, deliberately. service_role is the
-- trusted server identity that has to write a booking, its credit_ledger entry
-- and a Stripe PaymentIntent as one unit, and reconcile them from webhooks
-- afterwards. Trimming these grants would not add safety — anything holding
-- this key can already act as the platform — it would only produce a puzzling
-- 403 the next time a route needed a column nobody anticipated.

grant usage on schema public to service_role;

grant all privileges on table profiles to service_role;
grant all privileges on table spaces to service_role;
grant all privileges on table space_media to service_role;
grant all privileges on table availability to service_role;
grant all privileges on table bookings to service_role;
grant all privileges on table credit_ledger to service_role;

grant select on table spaces_public to service_role;
grant select on table public_host_profiles to service_role;
grant select on table availability_public to service_role;
grant select on table space_media_public to service_role;
grant select on table credit_balances to service_role;
grant select on table bookings_with_access_code to service_role;

grant execute on function space_access_details(uuid) to service_role;
grant execute on function host_bookings() to service_role;

-- Anything added later inherits these, so the next table does not repeat the
-- same debugging session.
alter default privileges in schema public
  grant all privileges on tables to service_role;
alter default privileges in schema public
  grant all privileges on sequences to service_role;
