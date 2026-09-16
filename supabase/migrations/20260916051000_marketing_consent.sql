-- Marketing consent proof and one-click unsubscribe.
--
-- Transactional booking, money and safety notifications continue to use the
-- notification outbox and never consult notify_offers. Marketing remains a
-- separate, default-off permission with an auditable opt-in/opt-out history.

alter table public.profiles
  add column if not exists marketing_consent_at timestamptz,
  add column if not exists marketing_unsubscribed_at timestamptz,
  add column if not exists marketing_consent_source text,
  add column if not exists marketing_unsubscribe_token uuid default gen_random_uuid();

update public.profiles
set marketing_unsubscribe_token = gen_random_uuid()
where marketing_unsubscribe_token is null;

update public.profiles
set marketing_consent_at = coalesce(marketing_consent_at, updated_at, created_at),
    marketing_unsubscribed_at = null,
    marketing_consent_source = coalesce(marketing_consent_source, 'legacy_in_app_setting')
where notify_offers is true;

create unique index if not exists profiles_marketing_unsubscribe_token_uidx
  on public.profiles(marketing_unsubscribe_token);

alter table public.profiles
  alter column marketing_unsubscribe_token set not null;

alter table public.profiles
  drop constraint if exists profiles_marketing_consent_consistent;
alter table public.profiles
  add constraint profiles_marketing_consent_consistent check (
    (
      notify_offers is true
      and marketing_consent_at is not null
      and marketing_unsubscribed_at is null
    )
    or notify_offers is false
  );

create or replace function public.record_marketing_preference_change()
returns trigger
language plpgsql
set search_path = 'public', 'pg_temp'
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.marketing_unsubscribe_token := gen_random_uuid();
      if new.notify_offers then
        new.marketing_consent_at := now();
        new.marketing_unsubscribed_at := null;
        new.marketing_consent_source := 'in_app_settings';
      else
        new.marketing_consent_at := null;
        new.marketing_unsubscribed_at := null;
        new.marketing_consent_source := null;
      end if;
    end if;
    return new;
  end if;

  if auth.uid() is not null then
    -- These are server-authored evidence, not editable profile fields.
    new.marketing_unsubscribe_token := old.marketing_unsubscribe_token;
    if new.notify_offers is distinct from old.notify_offers then
      if new.notify_offers then
        new.marketing_consent_at := now();
        new.marketing_unsubscribed_at := null;
        new.marketing_consent_source := 'in_app_settings';
      else
        new.marketing_consent_at := old.marketing_consent_at;
        new.marketing_unsubscribed_at := now();
        new.marketing_consent_source := old.marketing_consent_source;
      end if;
    else
      new.marketing_consent_at := old.marketing_consent_at;
      new.marketing_unsubscribed_at := old.marketing_unsubscribed_at;
      new.marketing_consent_source := old.marketing_consent_source;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.record_marketing_preference_change()
  from public, anon, authenticated;
grant execute on function public.record_marketing_preference_change() to service_role;

drop trigger if exists profiles_record_marketing_preference on public.profiles;
create trigger profiles_record_marketing_preference
  before insert or update of notify_offers, marketing_consent_at,
    marketing_unsubscribed_at, marketing_consent_source,
    marketing_unsubscribe_token
  on public.profiles
  for each row execute function public.record_marketing_preference_change();
