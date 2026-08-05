-- Storage policies that do not ask another table a question.
--
-- Listing a space failed at the upload with "new row violates row-level
-- security policy", and every unit test passed, because the policy is not
-- code — it is four lines of SQL in a database, and nothing ran them.
--
-- What narrowed it: in the *same* bucket, as the *same* user, in the *same*
-- request shape, `practitioner/{uid}/file` uploaded fine and
-- `space/{space_id}/file` was refused. The only difference between those two
-- policies is that the second asks `exists (select 1 from spaces …)`. The row
-- was there — the host could select it through PostgREST a moment earlier —
-- and the subquery still did not find it from inside a storage policy.
--
-- Rather than keep a rule whose behaviour depends on where it is evaluated
-- from, the question is removed. A file is filed under the id of the person it
-- belongs to, and the policy compares that to auth.uid() — the same shape as
-- the avatars and practitioner policies, both of which have always worked.
--
--   space-media          {host_id}/{space_id}/{file}
--   verification-docs    space/{host_id}/{space_id}/{file}
--
-- Three things get better, quite apart from uploads working:
--
--   * It stops depending on the `spaces` select policy. A future change there
--     could silently take uploads with it, and the failure would appear in a
--     completely unrelated part of the app.
--   * It removes the ordering. Files no longer have to wait for the row to
--     exist, so the create-row-then-delete-it-if-the-upload-fails dance is no
--     longer load-bearing.
--   * The space id stays in the path, so a listing's files are still grouped
--     and still deletable as one prefix.
--
-- What it gives up: the policy no longer proves the space belongs to the host,
-- only that the folder does. A host could file a document under a space id
-- that is not theirs — inside their own folder, readable only by them, and
-- reachable from nothing, since every read starts from a space row and its
-- recorded path. It buys nothing and exposes nothing.
--
-- Safe to apply as-is: all three buckets are empty, so there are no files to
-- move. If that stops being true, move the objects first — the policies below
-- will refuse the old paths.

do $$
declare existing record;
begin
  for existing in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (policyname like 'space-media:%' or policyname like 'verification-docs: host%')
  loop
    execute format('drop policy if exists %I on storage.objects', existing.policyname);
  end loop;
end $$;

-- ------------------------------------------------------------------
-- space-media — {host_id}/{space_id}/{file}
--
-- Public read, as before: these are photos of a room, never an address.
-- ------------------------------------------------------------------

create policy "space-media: public read"
  on storage.objects for select
  using (bucket_id = 'space-media');

create policy "space-media: host writes own folder"
  on storage.objects for insert
  with check (
    bucket_id = 'space-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "space-media: host updates own folder"
  on storage.objects for update
  using (
    bucket_id = 'space-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "space-media: host deletes own folder"
  on storage.objects for delete
  using (
    bucket_id = 'space-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ------------------------------------------------------------------
-- verification-docs — space/{host_id}/{space_id}/{file}
--
-- Still no public read, and still no policy granting anyone but the uploader
-- sight of it. Staff read these with the secret key through the admin route,
-- which signs one URL for one path after checking the session.
-- ------------------------------------------------------------------

create policy "verification-docs: host reads own space docs"
  on storage.objects for select
  using (
    bucket_id = 'verification-docs'
    and (storage.foldername(name))[1] = 'space'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "verification-docs: host writes own space docs"
  on storage.objects for insert
  with check (
    bucket_id = 'verification-docs'
    and (storage.foldername(name))[1] = 'space'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "verification-docs: host deletes own space docs"
  on storage.objects for delete
  using (
    bucket_id = 'verification-docs'
    and (storage.foldername(name))[1] = 'space'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
