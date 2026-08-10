-- Let a host write the paragraph their listing already shows.
--
-- `spaces.description` has existed since the first migration and the listing
-- screen has always rendered it. Nothing ever collected it: not the listing
-- form, not the edit screen, and `createSpace` did not write the column. Every
-- real listing has an empty one, which is why the app looked like it had
-- descriptions — the seeded fake data did, and the fakes were what got looked
-- at.
--
-- The column needs nothing. The grant does: 0019 revoked the blanket update on
-- `spaces` and re-granted per column, so anything added after it is read-only
-- until named here.

grant update (description) on spaces to authenticated;

-- A paragraph, not an essay. Long enough for what a room is like and short
-- enough that a practitioner reads it before choosing.
alter table spaces
  drop constraint if exists spaces_description_length;
alter table spaces
  add constraint spaces_description_length check (
    description is null or length(description) <= 1200
  );
