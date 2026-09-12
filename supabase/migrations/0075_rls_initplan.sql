-- Supabase Security Advisor: Auth RLS Initialization Plan
--
-- auth.uid()/auth.jwt()/auth.role() are stable for the duration of one query.
-- Calling them directly inside an RLS predicate can make Postgres re-evaluate
-- them for every candidate row. Wrapping them in a scalar SELECT turns them
-- into an InitPlan: once per statement, same authorization semantics.
--
-- This migration rewrites the policies that actually exist in the database,
-- rather than copying their business rules into yet another migration. It
-- changes only USING/WITH CHECK expressions; policy name, command, roles and
-- permissive/restrictive mode stay untouched.
--
-- Re-runnable: once an auth helper is already behind SELECT, that helper is
-- skipped on later runs.

do $$
declare
  p record;
  new_using text;
  new_check text;
  stmt text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname in ('public', 'storage')
  loop
    new_using := p.qual;
    new_check := p.with_check;

    -- pg_policies deparses an InitPlan as SELECT auth.uid()/jwt()/role().
    -- Only replace a helper while this expression has no existing SELECT for
    -- that helper, which makes the migration idempotent under the schema test's
    -- deliberate second pass.
    if new_using is not null then
      if new_using like '%auth.uid()%' and new_using !~* 'select\s+auth\.uid\(\)' then
        new_using := replace(new_using, 'auth.uid()', '(select auth.uid())');
      end if;
      if new_using like '%auth.jwt()%' and new_using !~* 'select\s+auth\.jwt\(\)' then
        new_using := replace(new_using, 'auth.jwt()', '(select auth.jwt())');
      end if;
      if new_using like '%auth.role()%' and new_using !~* 'select\s+auth\.role\(\)' then
        new_using := replace(new_using, 'auth.role()', '(select auth.role())');
      end if;
    end if;

    if new_check is not null then
      if new_check like '%auth.uid()%' and new_check !~* 'select\s+auth\.uid\(\)' then
        new_check := replace(new_check, 'auth.uid()', '(select auth.uid())');
      end if;
      if new_check like '%auth.jwt()%' and new_check !~* 'select\s+auth\.jwt\(\)' then
        new_check := replace(new_check, 'auth.jwt()', '(select auth.jwt())');
      end if;
      if new_check like '%auth.role()%' and new_check !~* 'select\s+auth\.role\(\)' then
        new_check := replace(new_check, 'auth.role()', '(select auth.role())');
      end if;
    end if;

    if new_using is distinct from p.qual or new_check is distinct from p.with_check then
      stmt := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);

      if new_using is distinct from p.qual then
        stmt := stmt || format(' using (%s)', new_using);
      end if;
      if new_check is distinct from p.with_check then
        stmt := stmt || format(' with check (%s)', new_check);
      end if;

      execute stmt;
    end if;
  end loop;
end $$;
