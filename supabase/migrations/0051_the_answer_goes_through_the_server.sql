-- Take back the write rights 0049 handed to hosts.
--
-- 0049 gave `authenticated` a column-level update grant on the three approval
-- columns and an RLS policy letting a host update bookings on their own
-- spaces. The reasoning in that file was that a host needs to be able to
-- answer a request, and it was wrong twice.
--
-- It is not needed. The only thing that answers a request is
-- /api/bookings/[id]/approval, which runs on the service role — the host's own
-- token never writes this table. The grant was surface with nothing behind it.
--
-- And it does harm. Answering is not one write; it is a write and a movement
-- of money, and the two only make sense together. A host with this grant could
-- PATCH the row directly and skip the second half:
--
--   approval_state = 'declined' with no release, and the guest's card stays
--   held on a booking the app shows as refused — until Stripe expires the
--   authorisation a week later, if anybody notices at all.
--
--   approval_state = 'approved' with no capture, and the guest is shown a
--   confirmed session that was never paid for. No door opens — access is gated
--   on `captured_at`, which nothing here can write — but the payout sweep will
--   never pay the host either, and both sides believe something different.
--
-- The comment in 0049 also claimed 0002 grants update on bookings wholesale.
-- It does not; 0002 grants select and nothing else. That mistake is why the
-- grant looked like a narrowing when it was the only update right on the table.
--
-- Written as a separate migration rather than a fix to 0049 because 0049 has
-- already run against the live database, and a migration that has run is
-- history. This is the correction, in the order it actually happened.

revoke update on bookings from authenticated;

drop policy if exists "bookings: host answers a request on their own space" on bookings;

-- The index stays. `host_requests()` reads on exactly these two columns, and it
-- is a security-definer function rather than a policy — nothing about who may
-- write the table changes what a host is allowed to read.
