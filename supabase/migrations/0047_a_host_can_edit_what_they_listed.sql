-- The five columns a host was allowed to fill in and never allowed to change.
--
-- 0019 revoked blanket update on `spaces` and granted it column by column, so
-- a host can correct their own listing and nothing else. Every migration since
-- that added a host-writable column re-granted it: 0026, 0028, 0029, 0031,
-- 0035, 0037. 0043 and 0045 added five and granted none.
--
-- Postgres checks UPDATE privilege on every column in the SET list, and
-- `editSpace` puts `suitable_for` and `room_setup` in every patch it builds.
-- So the failure is not confined to the new fields: the whole statement is
-- refused, and a host correcting their rate, their photographs' order, their
-- name or their entry instructions got `permission denied for table spaces`.
--
-- Which makes this the worse half of it. Entry instructions are the way into
-- somebody's building, and the reason a host changes them is usually that
-- somebody should no longer be able to get in. That revocation had no path.
--
-- Insert was never affected — 0002 grants it wholesale — so listings could be
-- created and then never corrected, which is why nothing caught it.

grant update (
  city,
  state,
  postal_code,
  suitable_for,
  room_setup
) on spaces to authenticated;
