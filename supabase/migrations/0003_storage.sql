-- Storage buckets
--
-- Three buckets, split by sensitivity rather than by feature, since that is
-- what the access policy actually depends on:
--
--   avatars        public read, one folder per user, owner-only write
--   space-media    public read (it's marketing content — photos/video of a
--                  room, never the address), host-only write on own space
--   verification-docs   private. Sublease proof, space insurance, and
--                  practitioner insurance certs. No in-app admin panel yet
--                  (the brief calls this out as deliberate, not an
--                  oversight), so review happens by staff through the
--                  Supabase dashboard with the service role — no client
--                  policy grants read access to anyone but the uploader.
--
-- Path convention: "{owner-scoped folder}/{filename}", so a single
-- storage.foldername(name) check can express "is this yours" without a
-- table join for avatars, and with one join for the space-scoped buckets.

insert into storage.buckets (id, name, public)
values
  ('avatars', 'avatars', true),
  ('space-media', 'space-media', true),
  ('verification-docs', 'verification-docs', false)
on conflict (id) do nothing;

-- ------------------------------------------------------------------
-- avatars — path: {user_id}/{filename}
-- ------------------------------------------------------------------

create policy "avatars: public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars: owner writes own folder"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars: owner updates own folder"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars: owner deletes own folder"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ------------------------------------------------------------------
-- space-media — path: {space_id}/{filename}
-- ------------------------------------------------------------------

create policy "space-media: public read"
  on storage.objects for select
  using (bucket_id = 'space-media');

create policy "space-media: host writes own space's folder"
  on storage.objects for insert
  with check (
    bucket_id = 'space-media'
    and exists (
      select 1 from spaces s
      where s.id::text = (storage.foldername(name))[1]
        and s.host_id = auth.uid()
    )
  );

create policy "space-media: host deletes own space's folder"
  on storage.objects for delete
  using (
    bucket_id = 'space-media'
    and exists (
      select 1 from spaces s
      where s.id::text = (storage.foldername(name))[1]
        and s.host_id = auth.uid()
    )
  );

-- ------------------------------------------------------------------
-- verification-docs — no public read.
-- Paths: space/{space_id}/{filename}, practitioner/{user_id}/{filename}
-- ------------------------------------------------------------------

create policy "verification-docs: host reads own space's docs"
  on storage.objects for select
  using (
    bucket_id = 'verification-docs'
    and (storage.foldername(name))[1] = 'space'
    and exists (
      select 1 from spaces s
      where s.id::text = (storage.foldername(name))[2]
        and s.host_id = auth.uid()
    )
  );

create policy "verification-docs: host writes own space's docs"
  on storage.objects for insert
  with check (
    bucket_id = 'verification-docs'
    and (storage.foldername(name))[1] = 'space'
    and exists (
      select 1 from spaces s
      where s.id::text = (storage.foldername(name))[2]
        and s.host_id = auth.uid()
    )
  );

create policy "verification-docs: practitioner reads own docs"
  on storage.objects for select
  using (
    bucket_id = 'verification-docs'
    and (storage.foldername(name))[1] = 'practitioner'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "verification-docs: practitioner writes own docs"
  on storage.objects for insert
  with check (
    bucket_id = 'verification-docs'
    and (storage.foldername(name))[1] = 'practitioner'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
