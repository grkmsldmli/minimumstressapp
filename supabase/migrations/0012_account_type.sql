-- One account is one side of the marketplace, chosen once.
--
-- This reverses an earlier decision, so the reasoning is worth recording. The
-- brief said "you can switch anytime from the top of either screen", and the
-- schema had no role column on purpose: the same person could book a room on
-- Tuesday and let one on Wednesday.
--
-- In practice the two sides are not two moods of one person. A practitioner
-- does not acquire a leasable room by changing a setting, and a studio owner
-- browsing for somewhere to teach is a different business with different
-- paperwork, a different fee, a different payout arrangement and a different
-- insurance position. Showing both sets of controls to everyone made the app
-- ask each person to ignore half of it.
--
-- So: an account is one or the other, picked at sign-up, and not switchable
-- afterwards. Somebody who genuinely is both opens a second account, which is
-- the honest shape of "these are two businesses".

do $$
begin
  create type account_type as enum ('practitioner', 'host');
exception
  when duplicate_object then null;
end $$;

-- Nullable, because a profile row is created the moment someone signs in and
-- the choice happens on the screen after that. Null means "has not chosen
-- yet", which the app treats as the one screen it must show them.
alter table profiles add column if not exists account_type account_type;

-- ------------------------------------------------------------------
-- Making "cannot be changed" true rather than merely unoffered.
--
-- Hiding the control is not the rule; it is a description of the current UI.
-- A client holding a publishable key can PATCH any column its grant allows,
-- so without this a practitioner could make themselves a host with one
-- request — and skip the sublease proof, the legal acknowledgement and the
-- payout setup that being a host is supposed to require.
--
-- Null to a value is permitted: that is the one-time choice. Value to a
-- different value is refused. The service role is exempt so staff can fix a
-- genuine mistake, which is the difference between immutable and a trap.
-- ------------------------------------------------------------------
create or replace function profiles_account_type_is_final()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.account_type is not null
     and new.account_type is distinct from old.account_type
     and current_user <> 'service_role'
  then
    raise exception 'account_type cannot be changed once it has been chosen'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_account_type_is_final on profiles;

create trigger profiles_account_type_is_final
  before update on profiles
  for each row
  execute function profiles_account_type_is_final();

-- ------------------------------------------------------------------
-- Listing a space requires being a host.
--
-- The trigger above stops the column changing; this stops it being
-- irrelevant. Without it, an account that never chose "host" could still
-- insert into spaces and the whole split would be decoration.
--
-- The existing policy is REPLACED rather than joined by a second one. Postgres
-- ORs permissive policies together, so adding "must be a host" beside "must be
-- your own row" would have meant either one passing — a restriction that
-- restricted nothing, and one that reads correct in a diff.
-- ------------------------------------------------------------------
drop policy if exists "spaces: host inserts own rows" on spaces;
drop policy if exists "spaces: only hosts may list" on spaces;

create policy "spaces: only hosts may list"
  on spaces for insert
  with check (
    host_id = auth.uid()
    and exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.account_type = 'host'
    )
  );
