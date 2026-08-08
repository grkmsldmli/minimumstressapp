-- A postcode somebody typed, kept until they change it.
--
-- Location has been per-visit until now, and for GPS that is the right
-- default: a coordinate is where a person physically is, we need it once to
-- sort a list, and keeping it would be building a record of somebody's
-- movements to save them a tap.
--
-- A postcode they typed is not that. It is a preference — "sort by what's near
-- my studio" — and asking for it every time is not privacy, it is friction
-- with nothing on the other side of it. Coarse enough to be a district rather
-- than an address, given deliberately, and changeable in one place.
--
-- The GPS path is unchanged and still forgets. Only what somebody wrote down
-- is remembered.

alter table profiles
  add column if not exists search_postcode text;

-- Long enough for anywhere that has postcodes, short enough that the column
-- cannot become a notes field.
alter table profiles
  drop constraint if exists profiles_search_postcode_length;
alter table profiles
  add constraint profiles_search_postcode_length check (
    search_postcode is null or length(btrim(search_postcode)) between 3 and 12
  );

-- ------------------------------------------------------------------
-- Writable by its owner, like the rest of the row.
--
-- 0019 revoked the blanket update on `spaces` and re-granted per column; the
-- profiles grant was never narrowed that way, so this needs nothing beyond the
-- policy that already restricts a profile to its owner.
-- ------------------------------------------------------------------
