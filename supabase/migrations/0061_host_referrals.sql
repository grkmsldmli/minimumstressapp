-- Host referrals — attribution, progress, and qualification. No reward yet.
--
-- The foundation for a host referral program: who brought whom, how far the
-- brought host has got, and the one moment the referral is genuinely qualified.
-- Attribution and anti-abuse only — there is no money here, no balance, no
-- amount, and none of those decisions are made.
--
-- Everything a client must not forge lives in server-only tables the definer
-- functions alone touch:
--   * referrer_codes — who is an eligible referrer, and their opaque code. The
--     code is here, not on the broadly client-writable profiles table, so a host
--     can never plant or change it. Eligibility is earned once, at a genuine
--     first approval, and never lost — the durable answer to "has had a listing
--     approved at some point".
--   * referrals — one row per brought host with server-written milestone
--     timestamps; the stable id a later reward attaches to.
--
-- A later rewards package attaches to referrals.id without rewriting any history.

-- ------------------------------------------------------------------
-- Close the space-approval insert gap first.
--
-- authenticated holds table-level INSERT on spaces (0002), and column grants
-- narrow only UPDATE (0019) — so a crafted insert could arrive already
-- status='active', sublease_doc_state='verified', review timestamps set, and
-- satisfy the active-listing constraints without a real staff approval (which
-- would also forge referrer eligibility below). This normalises every
-- client-created listing to a factual unreviewed, not-live state; staff (the
-- service role, no auth.uid()) are untouched, and normal Add Space is unaffected
-- because it never sets these fields. Going live and every review verdict remain
-- the server's, on insert as much as on update.
-- ------------------------------------------------------------------
create or replace function enforce_space_review_server_only()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null then
    new.status := 'pending';
    new.sublease_doc_state := 'pending';
    new.sublease_doc_reviewed_at := null;
    new.insurance_doc_state := 'pending';
    new.insurance_doc_reviewed_at := null;
    new.doc_review_note := null;
  end if;
  return new;
end;
$$;

drop trigger if exists spaces_review_server_only on spaces;
create trigger spaces_review_server_only
  before insert on spaces
  for each row
  execute function enforce_space_review_server_only();

-- ------------------------------------------------------------------
-- The referrer ledger — eligibility and the shareable code, server-only.
--
-- A row exists exactly for an established host: someone who has had a listing
-- genuinely approved. It is created at that first pending -> active approval and
-- never removed — not by delisting, not by an edit sending the listing back to
-- pending, not by a later rejection — so eligibility, once earned, is permanent.
-- The code lives here rather than on profiles, so a client can neither read the
-- ledger nor write, plant, or clear a code. RLS on with no policy and grants
-- revoked: only the definer functions below reach it.
-- ------------------------------------------------------------------
create table if not exists referrer_codes (
  -- Tied to the account. Deleting the Minimum Stress account cascades the profile
  -- away (auth.users -> profiles) and this row with it, so a departed host's code
  -- can no longer attribute anyone. Delisting or editing a space touches no
  -- profile, so eligibility survives that — exactly the intended lifecycle.
  host_id uuid primary key references profiles (id) on delete cascade,
  code text not null unique,
  eligible_since timestamptz not null default now()
);

alter table referrer_codes enable row level security;
revoke all on referrer_codes from anon, authenticated;

-- Grant a host their referrer row, idempotently, with a unique opaque code.
-- The code is eight characters from gen_random_uuid — not derived from the user
-- id — retried on the vanishingly rare collision. `p_since` lets the backfill
-- record the real historical approval time; live approvals use now().
create or replace function ensure_referrer(p_host_id uuid, p_since timestamptz default now())
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if exists (select 1 from referrer_codes where host_id = p_host_id) then
    return;
  end if;
  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    begin
      insert into referrer_codes (host_id, code, eligible_since)
        values (p_host_id, v_code, p_since);
      return;
    exception when unique_violation then
      -- Either another path just created this host's row, or the code collided.
      if exists (select 1 from referrer_codes where host_id = p_host_id) then
        return;
      end if;
      -- otherwise loop and pick another code
    end;
  end loop;
end;
$$;

-- Internal only. A SECURITY DEFINER function keeps its default PUBLIC execute
-- unless revoked, which would let any signed-in account mint itself referrer
-- eligibility and a code by calling this directly. It is reached only by the
-- go-live trigger and the backfill below — both run as the owner, so neither
-- needs a grant — and by nobody else.
revoke all on function ensure_referrer(uuid, timestamptz) from public;

-- The caller's own code, or null if they are not an eligible referrer. A pure
-- read: eligibility is earned by approval (the trigger below) or the backfill,
-- never by asking for the code. Exposes only the code, nothing else.
create or replace function my_referral_code()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select code from referrer_codes where host_id = auth.uid();
$$;

revoke all on function my_referral_code() from public;
grant execute on function my_referral_code() to authenticated;

-- ------------------------------------------------------------------
-- The referral ledger — one row per brought host, with the milestones it passes.
--
-- referred_host_id is UNIQUE, so a host is attributed to exactly one referrer,
-- once and for good. The three timestamps are the progression a later reward
-- reads: attributed, first listing live, first completed-and-paid booking. Like
-- founding_hosts, the ids carry no foreign key on purpose: the record must
-- outlive an account so a qualified referral survives the brought host deleting
-- theirs, and its id stays a stable anchor. Server-only: RLS on, no policy, no
-- grant, so referred_host_id (a raw user id) never leaves the database.
-- ------------------------------------------------------------------
create table if not exists referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null,
  referred_host_id uuid not null unique,
  attributed_at timestamptz not null default now(),
  listing_live_at timestamptz,
  qualified_at timestamptz,
  first_qualifying_booking_id uuid,
  constraint referrals_no_self check (referrer_id <> referred_host_id)
);

create index if not exists referrals_referrer_idx on referrals (referrer_id);

alter table referrals enable row level security;
revoke all on referrals from anon, authenticated;

-- ------------------------------------------------------------------
-- Lock attribution: the brought host, to the referrer whose code they used.
--
-- Called by the newly signed-in host with the code from their link. Definer, so
-- it resolves the referrer behind the code without exposing it. Every anti-abuse
-- rule lives here and in the UNIQUE column: an unknown code is a no-op; the
-- referrer must be an established host (a referrer_codes row); a host cannot
-- refer themselves; a host already attributed is never re-attributed (first
-- wins, locked); only a genuinely new host — one who has not started hosting —
-- is attributed at all; and a direct reciprocal loop is refused. The insert's
-- ON CONFLICT makes two racing calls settle on one row.
-- ------------------------------------------------------------------
create or replace function attribute_referral(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referred uuid := auth.uid();
  v_referrer uuid;
begin
  if v_referred is null then
    return;
  end if;
  if p_code is null or length(trim(p_code)) = 0 then
    return;
  end if;

  -- The code resolves only to an established, eligible referrer — a
  -- referrer_codes row is proof of a genuine approval at some point. A code
  -- supplied for any other account simply does not resolve here.
  select host_id into v_referrer from referrer_codes where code = upper(trim(p_code));
  if v_referrer is null then
    return;
  end if;
  if v_referrer = v_referred then
    return; -- no self-referral
  end if;

  -- Already attributed to someone: attribution is locked to the first referrer.
  if exists (select 1 from referrals where referred_host_id = v_referred) then
    return;
  end if;

  -- Only a genuinely new host — nobody who has already begun hosting. Any space
  -- at all (draft/pending/rejected/active/delisted) counts as having begun.
  if exists (select 1 from spaces where host_id = v_referred) then
    return;
  end if;

  -- No direct reciprocal loop: the referrer is not already referred by this host.
  if exists (
    select 1 from referrals
    where referrer_id = v_referred and referred_host_id = v_referrer
  ) then
    return;
  end if;

  insert into referrals (referrer_id, referred_host_id)
    values (v_referrer, v_referred)
    on conflict (referred_host_id) do nothing;
end;
$$;

revoke all on function attribute_referral(text) from public;
grant execute on function attribute_referral(text) to authenticated;

-- ------------------------------------------------------------------
-- A listing goes live: the host earns referrer eligibility, and referral
-- progress advances.
--
-- The one qualifying transition — pending to active — which after the insert
-- guard above only the service role's approval can cause. It does two things,
-- both permanent: it grants the host a referrer row (eligible for good), and, if
-- the host was themselves referred, records their first listing going live.
-- Relisting (delisted -> active) is not this transition and does not fire.
-- ------------------------------------------------------------------
create or replace function on_listing_first_live()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform ensure_referrer(new.host_id);
  update referrals
    set listing_live_at = now()
    where referred_host_id = new.host_id and listing_live_at is null;
  return null;
end;
$$;

-- Internal trigger helper, definer-run: revoke the default PUBLIC execute so it
-- can never be called directly, only fired by the trigger below.
revoke all on function on_listing_first_live() from public;

drop trigger if exists spaces_referral_on_live on spaces;
create trigger spaces_referral_on_live
  after update on spaces
  for each row
  when (old.status = 'pending' and new.status = 'active')
  execute function on_listing_first_live();

-- ------------------------------------------------------------------
-- Qualification: the brought host's first completed, captured hosted booking.
--
-- Fires the instant a booking on the brought host's space enters the same state
-- Host Achievements counts — status 'completed' AND captured_at set — regardless
-- of which of the two lands last. Marks the referral qualified exactly once
-- (qualified_at is null guards it) and records which booking did it. A later
-- booking finds qualified_at set and changes nothing, so qualification never
-- duplicates. Nothing here trusts a client: the state comes from the booking
-- lifecycle, and 0060's guard keeps a completed, captured booking from being
-- unwound.
-- ------------------------------------------------------------------
create or replace function mark_referral_qualified()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid;
begin
  select host_id into v_host from spaces where id = new.space_id;
  if v_host is null then
    return null;
  end if;

  update referrals
    set qualified_at = now(), first_qualifying_booking_id = new.id
    where referred_host_id = v_host and qualified_at is null;
  return null;
end;
$$;

-- Internal trigger helper, definer-run: revoke the default PUBLIC execute.
revoke all on function mark_referral_qualified() from public;

drop trigger if exists bookings_referral_qualify on bookings;
create trigger bookings_referral_qualify
  after update on bookings
  for each row
  when (
    (new.status = 'completed' and new.captured_at is not null)
    and not (old.status = 'completed' and old.captured_at is not null)
  )
  execute function mark_referral_qualified();

-- ------------------------------------------------------------------
-- What a referrer may see about their own referrals — and only this.
--
-- A safe projection: the referral's own id, its factual status, and when the
-- host joined. No referred_host_id, no name, no email, no listing, no booking,
-- no revenue — the raw user id never leaves the database. Definer, scoped to the
-- caller's own referrer_id.
--   joined       attributed, nothing more yet
--   space_live   their first listing is live
--   qualified    first completed, captured booking — the referral is qualified
-- ------------------------------------------------------------------
create or replace function my_referrals()
returns table (id uuid, status text, joined_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    case
      when r.qualified_at is not null then 'qualified'
      when r.listing_live_at is not null then 'space_live'
      else 'joined'
    end as status,
    r.attributed_at as joined_at
  from referrals r
  where r.referrer_id = auth.uid()
  order by r.attributed_at desc;
$$;

revoke all on function my_referrals() from public;
grant execute on function my_referrals() to authenticated;

-- ------------------------------------------------------------------
-- One-time backfill of referrer eligibility for hosts already established.
--
-- The trigger above only fires on future approvals, so existing hosts need their
-- eligibility granted from the strongest durable evidence the schema actually
-- holds: a currently-verified listing (a real approval, kept through delisting),
-- and founding_hosts (durable proof a host went live, even if their listing has
-- since been edited back to pending). eligible_since takes the earliest such
-- moment. Nothing is invented: a host with neither a verified listing nor a
-- founding record has no evidence of a past approval and is not granted a code —
-- they earn it on their next genuine approval. Idempotent via ensure_referrer.
-- ------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select ev.host_id, min(ev.since) as since
    from (
      select host_id, coalesce(sublease_doc_reviewed_at, created_at) as since
        from spaces
        where sublease_doc_state = 'verified'
      union all
      select host_id, earned_at as since
        from founding_hosts
    ) ev
    -- Only accounts that still exist: a founding_hosts row can outlive a deleted
    -- account, and referrer_codes now requires a live profile.
    join profiles p on p.id = ev.host_id
    group by ev.host_id
  loop
    perform ensure_referrer(r.host_id, r.since);
  end loop;
end;
$$;
