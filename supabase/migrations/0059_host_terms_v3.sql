-- Host Terms v3 — the prohibited-use list gains three entries.
--
-- Overnight/residential use, transferring or subletting a booking, and
-- intentional or reckless misuse of the space, furniture or equipment are now
-- named in the agreement, matching the platform's enforced list
-- (PROHIBITED_USES). New obligations on a host's guests, so the required version
-- rises to 3 and hosts re-accept on their next listing — exactly what the
-- versioning in 0052 was built to do. The app constant HOST_TERMS_VERSION
-- matches this (a schema test asserts the two agree).

create or replace function required_host_terms_version()
returns integer
language sql
immutable
as $$ select 3 $$;
