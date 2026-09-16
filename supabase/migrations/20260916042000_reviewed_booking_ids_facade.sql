-- Keep the client-facing reviewed-booking reader aligned with the project's
-- Security Advisor rule: privileged implementations live in private, while the
-- public RPC is a SECURITY INVOKER facade with the same narrow return shape.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create or replace function private._ms_reviewed_booking_ids_definer()
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

revoke all on function private._ms_reviewed_booking_ids_definer()
  from public, anon, authenticated, service_role;
grant execute on function private._ms_reviewed_booking_ids_definer()
  to authenticated, service_role;

create or replace function public.reviewed_booking_ids()
returns table(booking_id uuid)
language sql
stable
security invoker
set search_path = 'pg_catalog'
as $$
  select * from private._ms_reviewed_booking_ids_definer();
$$;

revoke all on function public.reviewed_booking_ids()
  from public, anon, authenticated, service_role;
grant execute on function public.reviewed_booking_ids()
  to authenticated, service_role;
