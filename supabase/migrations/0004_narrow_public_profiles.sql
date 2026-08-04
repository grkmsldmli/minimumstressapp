-- Narrow public_host_profiles to actual hosts.
--
-- As first written it selected every row in `profiles`, so a practitioner's
-- display name and avatar were world-readable to any anonymous caller — the
-- view's name claimed a restriction its body never applied.
--
-- Only someone with a live listing needs a public identity: that is the name
-- attached to a room in Discover. A practitioner has no public presence in this
-- product at all.
--
-- Note for later: a host legitimately needs to see who booked their space, and
-- that is now deliberately not served here. It belongs in a security definer
-- function scoped to "practitioners holding a booking on a space you own",
-- alongside space_access_details, rather than in a world-readable view.

create or replace view public_host_profiles as
  select p.id, p.display_name, p.avatar_path
  from profiles p
  where exists (
    select 1
    from spaces s
    where s.host_id = p.id
      and s.status = 'active'
  );

grant select on public_host_profiles to anon, authenticated;
