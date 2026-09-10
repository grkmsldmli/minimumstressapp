-- Archiving a listing: a permanent close that keeps the record.
--
-- Holding a listing (status 'delisted') is reversible — staff or the host can
-- put the room back on the site. Closing one for good is a different intent:
-- it comes off search and takes no more bookings, exactly like a hold, but it
-- is meant to stay that way, and everything behind it — the bookings, the
-- earnings, the reviews — is kept rather than erased.
--
-- This marks that intent without a new status value rippling through every
-- place that already reads 'delisted'. A listing is archived when archived_at
-- is set and held when it is null; the status stays 'delisted' either way, so
-- the search exclusion and the new-booking gate (both of which already refuse a
-- non-active space) need no change, and nothing here touches the bookings that
-- give a hard delete its ON DELETE RESTRICT.
--
-- Additive and backward compatible: the column is null on every existing row,
-- which is exactly right — nothing was archived before this existed.
alter table spaces
  add column if not exists archived_at timestamptz;
