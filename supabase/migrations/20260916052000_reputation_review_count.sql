-- A private reputation fact for the signed-in account.
--
-- The practitioner milestone previously hard-coded received reviews to zero.
-- Count only reviews that have actually cleared the blind-review boundary;
-- otherwise the number itself would tell somebody that the counterpart had
-- submitted while the review was still sealed.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create or replace function private._ms_my_released_review_count_definer()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)
  from public.reviews r
  where r.subject_id = auth.uid()
    and (
      exists (
        select 1
        from public.reviews counterpart
        where counterpart.booking_id = r.booking_id
          and counterpart.role <> r.role
      )
      or r.created_at + interval '14 days' <= now()
    );
$$;

revoke all on function private._ms_my_released_review_count_definer()
  from public, anon, authenticated, service_role;
grant execute on function private._ms_my_released_review_count_definer()
  to authenticated, service_role;

create or replace function public.my_released_review_count()
returns bigint
language sql
stable
security invoker
set search_path = 'pg_catalog'
as $$
  select private._ms_my_released_review_count_definer();
$$;

revoke all on function public.my_released_review_count()
  from public, anon, authenticated, service_role;
grant execute on function public.my_released_review_count()
  to authenticated, service_role;
