-- Repair the crash gap between a captured direct booking and the two durable
-- notification claims.  This lives after the money-operation journal so the
-- worker can refuse a booking while another financial transition owns it.
create or replace function public.list_booking_confirmation_notification_gaps(
  p_since timestamptz,
  p_now timestamptz default now(),
  p_limit integer default 100
)
returns table (id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 200 then
    raise exception 'p_limit must be between 1 and 200';
  end if;

  return query
  select b.id
  from public.bookings b
  join public.spaces s on s.id = b.space_id
  left join auth.users practitioner_user on practitioner_user.id = b.practitioner_id
  left join auth.users host_user on host_user.id = s.host_id
  left join public.profiles host_profile on host_profile.id = s.host_id
  where b.captured_at >= p_since
    and b.starts_at > p_now
    and b.status = 'upcoming'
    and b.cancelled_at is null
    and b.approval_state = 'not_required'
    and b.financial_resolution_state in ('not_required', 'resolved')
    and b.active_money_operation_id is null
    and (
      (
        practitioner_user.email is not null
        and not exists (
          select 1
          from public.notifications n
          where n.dedupe_key = 'booking_confirmed:' || b.id::text || ':email'
        )
      )
      or (
        host_user.email is not null
        and host_profile.notify_bookings is distinct from false
        and not exists (
          select 1
          from public.notifications n
          where n.dedupe_key = 'host_new_booking:' || b.id::text || ':email'
        )
      )
    )
  order by b.captured_at, b.id
  limit p_limit;
end;
$$;

revoke all on function public.list_booking_confirmation_notification_gaps(
  timestamptz, timestamptz, integer
) from public, anon, authenticated;
grant execute on function public.list_booking_confirmation_notification_gaps(
  timestamptz, timestamptz, integer
) to service_role;
