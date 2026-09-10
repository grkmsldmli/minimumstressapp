-- Optimized image variants for listing media.
--
-- A host's phone photo is stored and served at full size — up to 12 MB — even
-- into a 145px Discover card. New image uploads now carry two resized WebP
-- variants: storage_path holds the detail-size image (long edge 1600) and a new
-- card_path holds the card thumbnail (long edge 600). No huge original is kept;
-- nothing in the product serves one.
--
-- card_path is nullable so existing rows — which have only their original in
-- storage_path — keep working unchanged: the app falls back to storage_path
-- wherever a card variant is absent. Video rows never carry a card_path.
--
-- The private/signed-URL architecture is untouched: both paths live under the
-- same {host_id}/{space_id}/ prefix in the private bucket and are handed out
-- only through the authenticated /api/spaces/media/sign route, which authorises
-- either column against its own media row. Anonymous access stays closed — the
-- view is recreated (a new column needs a fresh view) and re-granted to
-- authenticated and service_role only, never anon (0064).
--
-- ROLLOUT ORDER: apply this migration BEFORE deploying the code, because the new
-- signing route selects space_media.card_path and would error against a database
-- that has no such column. This is an expand-only migration, so applying it
-- while the CURRENTLY DEPLOYED (old) code is still running is safe:
--   * card_path is nullable with no default — old inserts that omit it still
--     succeed (card_path stays NULL);
--   * space_media_public is widened, not narrowed — the old client reads it with
--     select(*) and simply ignores the extra column; no old code references it;
--   * the old signing route only queries storage_path, which is unchanged.
-- So the safe sequence is: apply 0066 → deploy the new code. Backward
-- compatibility is asserted in supabase/schema.test.ts.

alter table space_media add column if not exists card_path text;

drop view if exists space_media_public;

create view space_media_public as
  select m.id, m.space_id, m.storage_path, m.card_path, m.kind, m.position
  from space_media m
  join spaces s on s.id = m.space_id
  where s.status = 'active';

-- Authenticated marketplace users and the service role only. Anon is deliberately
-- omitted: individual listing media is private (0064), reached through signed URLs.
grant select on space_media_public to authenticated;
grant select on space_media_public to service_role;
