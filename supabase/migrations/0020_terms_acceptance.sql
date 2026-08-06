-- Who agreed to what, and when.
--
-- The terms existed and nobody had accepted them. A host acknowledged
-- something per listing — `spaces.legal_ack_at`, which covers the sublease
-- declaration for that one room — and a practitioner accepted nothing at all.
-- So the rule that matters most commercially, that a session arranged off the
-- app is between the two people who arranged it, was written down where
-- neither of them had ever agreed to it.
--
-- "It was in the terms" is worth little without a record of the moment it was
-- shown and taken. This is that record: one row per account, the version they
-- accepted, and the time.
--
-- Versioned rather than a boolean, because the terms will change. A boolean
-- says somebody once agreed to something; a version says what. When the text
-- changes materially the constant in the app moves, and everyone is asked
-- again — which is the only honest way to keep the record true.

alter table profiles
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version integer;

-- Both or neither. A version with no timestamp is a claim with no moment
-- behind it, and a timestamp with no version is a moment with no text.
alter table profiles
  drop constraint if exists profiles_terms_consistent;
alter table profiles
  add constraint profiles_terms_consistent check (
    (terms_accepted_at is null) = (terms_version is null)
  );

-- ------------------------------------------------------------------
-- Write-once per version, and never backdated.
--
-- Acceptance is a fact about a past moment. A client that could set the
-- timestamp would be able to say somebody agreed last year, and one that could
-- lower the version would be able to un-accept a change they had already been
-- shown. Both are decided here rather than trusted to the caller.
-- ------------------------------------------------------------------
create or replace function enforce_terms_acceptance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  was integer := case when tg_op = 'UPDATE' then old.terms_version else null end;
begin
  /*
   * Insert as well as update, because the client upserts.
   *
   * The app writes a profile with `on conflict do update`, and Postgres checks
   * the proposed tuple before the conflict is resolved. A trigger that only
   * fired on UPDATE therefore never ran: the version arrived without a
   * timestamp, and the constraint below — the one insisting the two agree —
   * rejected it. Both paths, so acceptance is recorded however it arrives.
   */
  if new.terms_version is distinct from was
     or (tg_op = 'UPDATE' and new.terms_accepted_at is distinct from old.terms_accepted_at) then

    if new.terms_version is null then
      if was is null then
        return new;
      end if;
      raise exception 'Accepted terms cannot be withdrawn.'
        using errcode = 'check_violation';
    end if;

    if was is not null and new.terms_version < was then
      raise exception 'Terms version cannot go backwards.'
        using errcode = 'check_violation';
    end if;

    -- The clock is the server's, whatever the client sent.
    new.terms_accepted_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_terms_acceptance on profiles;

create trigger profiles_terms_acceptance
  before insert or update on profiles
  for each row
  when (auth.uid() is not null)
  execute function enforce_terms_acceptance();

-- ------------------------------------------------------------------
-- Existing accounts.
--
-- Left null on purpose. Backfilling would record an acceptance that never
-- happened, which is worse than having none — it is the one field whose whole
-- value is that it is true. They are asked next time they open the app.
-- ------------------------------------------------------------------
