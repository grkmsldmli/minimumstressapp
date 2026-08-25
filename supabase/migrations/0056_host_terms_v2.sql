-- Host Terms v2 — the allowed-use examples drop their consumer framing.
--
-- The example uses in the Host Terms named "personal practice" and "dance and
-- movement rehearsal", from when a room could be booked for those. The
-- marketplace offers professional work now and the booking menu no longer lists
-- them, so the examples were stale. Only the illustrative list changes; the
-- substance of the agreement does not.
--
-- Because the wording changed, the required version rises to 2. The app constant
-- HOST_TERMS_VERSION matches it (a schema test asserts the two agree). Existing
-- acceptances stand and existing listings keep running; a host is asked to
-- accept again the next time they list, which is exactly what the versioning in
-- 0052 was built to do.

create or replace function required_host_terms_version()
returns integer
language sql
immutable
as $$ select 2 $$;
