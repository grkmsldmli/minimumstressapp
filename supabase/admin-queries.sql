-- Operational queries — what is happening in the marketplace right now.
--
-- There is no in-app admin panel yet; the brief defers it deliberately. Until
-- there is one, this is the substitute: paste any block into the Supabase SQL
-- editor, or save each as a named query so it is one click away.
--
-- Ordered by how often you will actually need them. The first two are the ones
-- that block real people if nobody looks.

-- ===================================================================
-- 1. LISTINGS WAITING FOR REVIEW
--
-- A host who finished the wizard is sitting here unable to earn anything
-- until someone approves them. This is the query that matters most, because
-- the delay is invisible to them and looks like the product is broken.
-- ===================================================================
select
  s.id,
  s.name,
  s.category,
  (s.hourly_rate_cents / 100.0)::money as hourly_rate,
  s.capacity,
  s.access_type,
  p.display_name              as host,
  u.email                     as host_email,
  s.sublease_doc_path,
  s.insurance_doc_path,
  s.created_at,
  now() - s.created_at        as waiting_for
from spaces s
join profiles p on p.id = s.host_id
join auth.users u on u.id = s.host_id
where s.status = 'pending'
order by s.created_at;

-- Approve one, once its documents check out:
--   update spaces set status = 'active' where id = '<space-id>';
-- Turn one down (it stays out of Discover either way):
--   update spaces set status = 'delisted' where id = '<space-id>';


-- ===================================================================
-- 2. MONEY THAT SHOULD HAVE MOVED AND DID NOT
--
-- A booking whose session has started but whose card was never captured.
-- Usually an expired authorization — card holds lapse after about a week —
-- or a card that failed at capture time. Either way the host is expecting
-- money that is not coming unless someone intervenes.
-- ===================================================================
select
  b.id,
  b.starts_at,
  now() - b.starts_at            as overdue_by,
  (b.total_cents / 100.0)::money as total,
  (b.host_rate_cents / 100.0)::money as host_is_owed,
  b.stripe_payment_intent_id,
  s.name                         as space,
  hp.display_name                as host,
  pp.display_name                as practitioner
from bookings b
join spaces s   on s.id = b.space_id
join profiles hp on hp.id = s.host_id
join profiles pp on pp.id = b.practitioner_id
where b.status = 'upcoming'
  and b.starts_at < now()
  and b.captured_at is null
order by b.starts_at;


-- ===================================================================
-- 3. HOSTS WHO CANNOT BE PAID
--
-- They started Stripe onboarding and never finished. Their listing may be
-- live, but any booking attempt is refused — so they see silence and assume
-- there is no demand.
-- ===================================================================
select
  p.id,
  p.display_name,
  u.email,
  p.stripe_connect_account_id,
  count(s.id) filter (where s.status = 'active') as live_listings
from profiles p
join auth.users u on u.id = p.id
left join spaces s on s.host_id = p.id
where p.stripe_connect_account_id is not null
  and p.stripe_connect_charges_enabled = false
group by p.id, p.display_name, u.email, p.stripe_connect_account_id
order by live_listings desc;


-- ===================================================================
-- 4. WHAT IS BOOKED
-- ===================================================================
select
  b.starts_at,
  s.name                             as space,
  pp.display_name                    as practitioner,
  hp.display_name                    as host,
  (b.total_cents / 100.0)::money     as practitioner_paid,
  (b.host_rate_cents / 100.0)::money as host_receives,
  (b.platform_cents / 100.0)::money  as our_cut,
  b.is_instant,
  b.was_pro,
  b.status
from bookings b
join spaces s    on s.id = b.space_id
join profiles pp on pp.id = b.practitioner_id
join profiles hp on hp.id = s.host_id
where b.starts_at > now() - interval '7 days'
order by b.starts_at desc;


-- ===================================================================
-- 5. THE MONTH SO FAR
--
-- our_cut is gross. Stripe's processing fee comes out of it — roughly 2.9%
-- plus 30c per booking — so net is lower. The Stripe dashboard is the
-- authority on that; this is the shape of the business, not the bank balance.
-- ===================================================================
select
  count(*)                                    as bookings,
  count(*) filter (where is_instant)          as instant,
  count(*) filter (where was_pro)             as by_pro_members,
  (sum(total_cents) / 100.0)::money           as practitioners_paid,
  (sum(host_rate_cents) / 100.0)::money       as hosts_earned,
  (sum(platform_cents) / 100.0)::money        as our_gross_cut,
  (sum(credit_applied_cents) / 100.0)::money  as credit_redeemed
from bookings
where captured_at >= date_trunc('month', now());


-- ===================================================================
-- 6. OUTSTANDING CREDIT
--
-- Goodwill we owe. Every dollar here is a future booking where our fee gets
-- waived, so it is a real liability even though no money has left yet.
-- ===================================================================
select
  p.display_name,
  u.email,
  (cb.balance_cents / 100.0)::money as balance
from credit_balances cb
join profiles p   on p.id = cb.practitioner_id
join auth.users u on u.id = cb.practitioner_id
where cb.balance_cents > 0
order by cb.balance_cents desc;

-- And the total exposure:
select (coalesce(sum(balance_cents), 0) / 100.0)::money as total_credit_owed
from credit_balances
where balance_cents > 0;


-- ===================================================================
-- 7. CANCELLATIONS
--
-- Worth watching by host. A host who repeatedly cancels on practitioners
-- costs us goodwill credit every time and costs practitioners a room they
-- were counting on.
-- ===================================================================
select
  hp.display_name                        as host,
  count(*)                               as cancellations,
  (sum(b.platform_cents) / 100.0)::money as goodwill_credit_issued
from bookings b
join spaces s    on s.id = b.space_id
join profiles hp on hp.id = s.host_id
where b.status = 'cancelled_by_host'
group by hp.display_name
order by cancellations desc;

-- ------------------------------------------------------------------
-- 8. Who has asked to move to the other side of the marketplace
--
-- Nothing switches an account automatically, and that is deliberate. A host
-- needs sublease proof, a legal acknowledgement and payout setup; a
-- practitioner needs insurance. Approving a change hands somebody the
-- obligations of a side they have not been checked against, so read the reason
-- and look at what they already have before running the statement below.
-- ------------------------------------------------------------------
select
  r.id,
  r.created_at,
  p.display_name,
  u.email,
  r.current_type,
  r.requested_type,
  r.reason,
  -- What they would be giving up or taking on, so the decision is informed
  -- rather than a yes/no on a name.
  (select count(*) from spaces s where s.host_id = r.user_id) as spaces_listed,
  (select count(*) from bookings b where b.practitioner_id = r.user_id) as bookings_made,
  p.stripe_connect_charges_enabled as can_be_paid,
  p.insurance_doc_path is not null as has_insurance
from account_type_change_requests r
join profiles p on p.id = r.user_id
join auth.users u on u.id = r.user_id
where r.state = 'open'
order by r.created_at;

-- To approve one. Both statements or neither — a request marked approved
-- without the profile changing is a promise nobody kept, and a profile changed
-- without the request closed comes back tomorrow.
--
--   begin;
--   update profiles
--      set account_type = (select requested_type from account_type_change_requests where id = '<request-id>')
--    where id = (select user_id from account_type_change_requests where id = '<request-id>');
--   update account_type_change_requests
--      set state = 'approved', decided_at = now(), decided_note = '<why>'
--    where id = '<request-id>';
--   commit;
--
-- To decline:
--
--   update account_type_change_requests
--      set state = 'declined', decided_at = now(), decided_note = '<why>'
--    where id = '<request-id>';
