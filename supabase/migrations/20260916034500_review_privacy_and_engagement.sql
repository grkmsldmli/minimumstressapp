-- Review privacy + lifecycle engagement.
--
-- 1) A host's review is about the practitioner. It must never appear on the
--    host's room listing just because it shares the booking's space_id.
-- 2) Review prompt retries stop the moment that side has already reviewed, so
--    a temporary provider failure cannot produce a stale "please review" email
--    days after the person already did it.

create or replace view private._ms_public_reviews_definer as
  select
    r.id,
    r.subject_id,
    b.space_id,
    r.role,
    r.overall,
    r.comment,
    r.created_at
  from public.reviews r
  join public.bookings b on b.id = r.booking_id
  where r.role = 'practitioner'::public.reviewer_role
    and (
      exists (
        select 1
        from public.reviews other
        where other.booking_id = r.booking_id
          and other.role <> r.role
      )
      or r.created_at + interval '14 days' <= now()
    );

-- The public facade keeps the same seven-column shape. Re-assert its narrow ACL
-- so this migration cannot accidentally broaden the signed-in-only listing data.
revoke all on private._ms_public_reviews_definer from public, anon, authenticated, service_role;
grant select on private._ms_public_reviews_definer to authenticated, service_role;

create or replace function public.notification_delivery_is_current(
  p_kind text,
  p_booking_id uuid,
  p_dedupe_key text,
  p_channel text,
  p_now timestamptz,
  p_require_settled boolean default false
)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  return case
    when p_kind not in (
      'booking_confirmed', 'host_new_booking', 'request_approved',
      'host_new_request', 'request_submitted', 'host_request_reminder',
      'host_payout_sent', 'access_code_ready', 'new_message',
      'review_prompt', 'review_reminder', 'review_submitted',
      'counterpart_reviewed', 'review_published',
      'request_declined', 'request_expired',
      'cancelled_by_practitioner', 'cancelled_by_host',
      'refund_requested', 'refund_decided', 'refund_taken_back'
    ) then true
    when p_booking_id is null then false
    else coalesce((
      select case
        when p_kind in ('booking_confirmed', 'host_new_booking') then
          b.status = 'upcoming'
          and b.cancelled_at is null
          and b.financial_resolution_state in ('not_required', 'resolved')
          and b.active_money_operation_id is null
          and b.captured_at is not null
        when p_kind = 'request_approved' then
          b.status = 'upcoming'
          and b.cancelled_at is null
          and b.financial_resolution_state in ('not_required', 'resolved')
          and b.active_money_operation_id is null
          and b.approval_state = 'approved'
          and b.captured_at is not null
        when p_kind in (
          'host_new_request', 'request_submitted', 'host_request_reminder'
        ) then
          b.status = 'upcoming'
          and b.cancelled_at is null
          and b.financial_resolution_state = 'not_required'
          and b.active_money_operation_id is null
          and b.approval_state = 'pending'
          and b.authorized_at is not null
          and b.captured_at is null
        when p_kind = 'host_payout_sent' then
          b.host_paid_at is not null
          and b.stripe_transfer_id is not null
          and b.host_rate_refunded is false
          and b.financial_resolution_state in ('not_required', 'resolved')
          and b.active_money_operation_id is null
          and p_dedupe_key = 'host_payout_sent:' || b.id::text || ':' || p_channel
          and exists (
            select 1
            from public.booking_money_operations o
            where o.booking_id = b.id
              and o.kind = 'payout'
              and o.state = 'committed'
              and o.stripe_transfer_id = b.stripe_transfer_id
          )
        when p_kind = 'access_code_ready' then
          b.status = 'upcoming'
          and b.cancelled_at is null
          and b.financial_resolution_state in ('not_required', 'resolved')
          and b.active_money_operation_id is null
          and b.captured_at is not null
          and b.access_code is not null
          and b.access_code_revealed_at <= p_now
          and b.ends_at > p_now
        when p_kind = 'new_message' then
          b.captured_at is not null
          and b.status not in ('cancelled_by_practitioner', 'cancelled_by_host')
          and b.cancelled_at is null
          and b.financial_resolution_state in ('not_required', 'resolved')
          and b.active_money_operation_id is null
        when p_kind in ('review_prompt', 'review_reminder') then
          b.status = 'completed'
          and b.cancelled_at is null
          and b.captured_at is not null
          and b.ends_at <= p_now
          and b.ends_at + interval '30 days' > p_now
          and (
            (
              p_dedupe_key like p_kind || ':' || b.id::text || ':practitioner:%:' || p_channel
              and not exists (
                select 1 from public.reviews r
                where r.booking_id = b.id and r.role = 'practitioner'
              )
            )
            or
            (
              p_dedupe_key like p_kind || ':' || b.id::text || ':host:%:' || p_channel
              and not exists (
                select 1 from public.reviews r
                where r.booking_id = b.id and r.role = 'host'
              )
            )
          )
        when p_kind = 'review_submitted' then
          exists (
            select 1 from public.reviews r
            where r.booking_id = b.id
              and p_dedupe_key =
                'review_submitted:' || r.id::text || ':author:' || p_channel
          )
        when p_kind = 'counterpart_reviewed' then
          (select count(*) from public.reviews r where r.booking_id = b.id) = 2
          and exists (
            select 1 from public.reviews first_review
            where first_review.booking_id = b.id
              and p_dedupe_key =
                'counterpart_reviewed:' || b.id::text || ':' ||
                first_review.role::text || ':' || p_channel
          )
        when p_kind = 'review_published' then
          exists (
            select 1 from public.reviews r
            where r.booking_id = b.id
              and (
                r.created_at + interval '14 days' <= p_now
                or exists (
                  select 1 from public.reviews other
                  where other.booking_id = r.booking_id and other.role <> r.role
                )
              )
              and p_dedupe_key = 'review_published:' || r.id::text || ':' || p_channel
          )
        when p_kind = 'request_declined' then
          b.approval_state = 'declined'
          and (
            not p_require_settled
            or (
              b.financial_resolution_state = 'resolved'
              and b.active_money_operation_id is null
            )
          )
        when p_kind = 'request_expired' then
          b.approval_state = 'expired'
          and (
            not p_require_settled
            or (
              b.financial_resolution_state = 'resolved'
              and b.active_money_operation_id is null
            )
          )
        when p_kind = 'cancelled_by_practitioner' then
          b.cancelled_by = 'practitioner'
          and (
            not p_require_settled
            or (
              b.financial_resolution_state = 'resolved'
              and b.active_money_operation_id is null
            )
          )
        when p_kind = 'cancelled_by_host' then
          b.cancelled_by = 'host'
          and (
            not p_require_settled
            or (
              b.financial_resolution_state = 'resolved'
              and b.active_money_operation_id is null
            )
          )
        when p_kind = 'refund_requested' then
          b.financial_resolution_state in ('not_required', 'resolved')
          and b.active_money_operation_id is null
          and exists (
            select 1
            from public.refund_requests r
            where r.booking_id = b.id
              and r.state = 'awaiting_host'
              and p_dedupe_key = 'refund_requested:' || r.id::text || ':' || p_channel
          )
        when p_kind = 'refund_decided' then
          b.financial_resolution_state in ('not_required', 'resolved')
          and b.active_money_operation_id is null
          and exists (
            select 1
            from public.refund_requests r
            join public.booking_money_operations o
              on o.refund_request_id = r.id
            where r.booking_id = b.id
              and r.state in ('approved', 'refused')
              and o.kind = 'refund_request'
              and o.state = 'committed'
              and p_dedupe_key = 'refund_decided:' || r.id::text || ':' || p_channel
          )
        when p_kind = 'refund_taken_back' then
          b.host_paid_at is not null
          and b.financial_resolution_state in ('not_required', 'resolved')
          and b.active_money_operation_id is null
          and exists (
            select 1
            from public.refund_requests r
            join public.booking_money_operations o
              on o.refund_request_id = r.id
            where r.booking_id = b.id
              and r.state = 'approved'
              and r.outcome = 'full'
              and o.kind = 'refund_request'
              and o.state = 'committed'
              and o.expected_reversal_cents > 0
              and o.stripe_reversal_id is not null
              and p_dedupe_key = 'refund_taken_back:' || r.id::text || ':' || p_channel
          )
        else false
      end
      from public.bookings b
      where b.id = p_booking_id
    ), false)
  end;
end;
$$;

revoke all on function public.notification_delivery_is_current(
  text, uuid, text, text, timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.notification_delivery_is_current(
  text, uuid, text, text, timestamptz, boolean
) to service_role;


-- A signed-in account needs one private fact to keep review CTAs honest: which
-- of its own bookings it has already reviewed. Expose only ids authored by the
-- caller; the review text, stars and counterpart remain behind the normal views.
create or replace function public.reviewed_booking_ids()
returns table(booking_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select r.booking_id
  from public.reviews r
  where r.author_id = auth.uid();
$$;
revoke all on function public.reviewed_booking_ids() from public, anon;
grant execute on function public.reviewed_booking_ids() to authenticated;

-- Listing copy is public marketplace copy, not a back door for exchanging
-- contact details or payment handles. This is the database backstop beneath
-- the normal UI validation: a modified client cannot publish an email, URL,
-- social handle, payment app or obvious phone number into public room text.
create or replace function private._ms_has_offplatform_contact(value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(value, '') ~* '([[:alnum:]_.%+\-]+[[:space:]]*@[[:space:]]*[[:alnum:].\-]+\.[[:alpha:]]{2,})'
      or coalesce(value, '') ~* '(https?://|www\.|[[:alnum:]_-]+\.(com|net|org|io|co|app|me|link)([^[:alnum:]]|$))'
      or coalesce(value, '') ~* '(^|[^[:alnum:]_])@[[:alpha:]][[:alnum:]_.]{2,}'
      or coalesce(value, '') ~* '\m(whats[[:space:]]?app|telegram|instagram|insta|snapchat|wechat|viber|messenger|venmo|paypal|cash[[:space:]]?app|zelle|revolut)\M'
      or coalesce(value, '') ~* '(^|[^0-9])\+?[0-9][0-9[:space:]().\-]{5,}[0-9]([^0-9]|$)';
$$;

create or replace function public.enforce_space_contact_safety()
returns trigger
language plpgsql
set search_path = 'public', 'private', 'pg_temp'
as $$
begin
  if private._ms_has_offplatform_contact(new.name)
     or private._ms_has_offplatform_contact(new.description)
     or private._ms_has_offplatform_contact(new.house_rules)
     or private._ms_has_offplatform_contact(new.entry_instructions)
     or private._ms_has_offplatform_contact(array_to_string(new.requirements, ' ')) then
    raise exception 'Listing text cannot contain contact details, external links, social handles, or off-platform payment details'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists spaces_contact_safety on public.spaces;
create trigger spaces_contact_safety
before insert or update of name, description, house_rules, entry_instructions, requirements on public.spaces
for each row execute function public.enforce_space_contact_safety();
