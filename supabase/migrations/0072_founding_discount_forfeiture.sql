-- Founding discount forfeiture.
--
-- Founding STATUS (badge, number, founding_host_at / founding_practitioner_at) is
-- permanent and untouched here. What this adds is the persistent record that the
-- Founding 50% SUBSCRIPTION rate has been spent: it is permanent only while the
-- paid Pro subscription stays continuously active after conversion. Once a
-- founding-discounted paid subscription terminally ends, the 50% right is gone
-- for good — a future resubscribe is at full price — and that fact must survive
-- as account history, not be re-inferred from "is there a live subscription now".
--
-- Two nullable timestamps, written ONLY by the server (the Stripe webhook, at the
-- real terminal-cancellation transition). A guard refuses any client write to
-- them, mirroring enforce_studio_pro_server_only (0070). The webhook only ever
-- SETS them (once, where currently null) and never clears them, so duplicate or
-- out-of-order events can neither double-forfeit nor un-forfeit.
--
-- Purely additive and idempotent: add-column-if-not-exists, create-or-replace
-- function, drop-then-create trigger. No table is added; no applied migration is
-- edited.

alter table profiles
  add column if not exists founding_practitioner_discount_forfeited_at timestamptz,
  add column if not exists founding_host_discount_forfeited_at timestamptz;

-- The forfeiture timestamps are the server's to set (via the Stripe webhook),
-- never the client's — the same discipline as studio_pro / identity / founding.
create or replace function enforce_founding_forfeiture_server_only()
returns trigger
language plpgsql
as $$
declare
  ins boolean := tg_op = 'INSERT';
begin
  if auth.uid() is not null
     and (
       new.founding_practitioner_discount_forfeited_at
         is distinct from (case when ins then null else old.founding_practitioner_discount_forfeited_at end)
       or new.founding_host_discount_forfeited_at
         is distinct from (case when ins then null else old.founding_host_discount_forfeited_at end)
     ) then
    raise exception 'founding discount forfeiture is set by the server, not the client'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_founding_forfeiture_server_only on profiles;
create trigger profiles_founding_forfeiture_server_only
  before insert or update on profiles
  for each row execute function enforce_founding_forfeiture_server_only();
