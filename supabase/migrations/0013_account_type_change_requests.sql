-- Asking to move to the other side of the marketplace.
--
-- 0012 made account_type unchangeable by the client and left the service role
-- able to change it, which is the difference between a rule and a trap. This
-- is the front door to that exemption: somebody who picked wrong, or whose
-- circumstances genuinely changed, asks — and a person decides.
--
-- Deliberately not self-service. Becoming a host means sublease proof, a legal
-- acknowledgement and payout setup; becoming a practitioner means insurance.
-- A switch that skipped those would let an account acquire obligations it had
-- never satisfied, which is the whole reason the column is locked.

do $$
begin
  create type account_change_state as enum ('open', 'approved', 'declined');
exception
  when duplicate_object then null;
end $$;

create table if not exists account_type_change_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,

  -- Recorded rather than derived, so the record still reads correctly after
  -- the change has been applied and the profile no longer says what it was.
  current_type account_type not null,
  requested_type account_type not null,

  reason text not null default '',
  state account_change_state not null default 'open',

  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_note text,

  constraint account_change_is_a_change check (current_type <> requested_type)
);

-- One open request per person. Without this, a refusal can be answered by
-- asking again immediately, and the queue becomes a way to apply pressure.
create unique index if not exists account_change_one_open_per_user
  on account_type_change_requests (user_id)
  where state = 'open';

create index if not exists account_change_open_idx
  on account_type_change_requests (created_at)
  where state = 'open';

-- ------------------------------------------------------------------
-- Access
--
-- Someone may read their own requests, so the app can show "we are looking at
-- this" rather than swallowing the ask. Writing goes through a server route —
-- the current_type on the row must be the profile's real one, and a client
-- that could set it could describe a change it is not actually making.
-- ------------------------------------------------------------------
alter table account_type_change_requests enable row level security;

do $$
declare existing record;
begin
  for existing in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'account_type_change_requests'
  loop
    execute format('drop policy if exists %I on public.account_type_change_requests', existing.policyname);
  end loop;
end $$;

create policy "account changes: read own"
  on account_type_change_requests for select
  using (user_id = auth.uid());

grant select on account_type_change_requests to authenticated;
grant select, insert, update on account_type_change_requests to service_role;
