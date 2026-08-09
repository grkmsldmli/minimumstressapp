-- What we sent you, where you can find it.
--
-- The app has been sending email since the first booking and keeping no
-- record anybody could read. A host who missed the message about a session
-- starting in an hour had nowhere to look — not a stale inbox, not a spam
-- folder, nothing inside the product that could tell them it had been sent at
-- all. The row existed the whole time; only staff could see it.
--
-- Exposed through a view rather than a policy on the table, because most of
-- what the table holds is an operator's business and not the recipient's:
--
--   dedupe_key   an internal claim token
--   attempts     how hard the queue tried
--   last_error   a provider's words, written for us
--   dropped_at   that we gave up
--
-- None of that helps somebody asking "did the door code come through". What
-- does help is what it was about, when it was sent, and — plainly — when it
-- was not.

create or replace view my_notifications
with (security_invoker = true) as
  select
    id,
    booking_id,
    kind,
    channel,
    sent_at,
    created_at,
    /*
     * Three states, and the third is the one this exists for.
     *
     * "Sent" and "queued" are both fine. "Failed" is the answer somebody is
     * actually looking for when they are standing outside a door, and the app
     * has never been able to give it.
     */
    case
      when sent_at is not null then 'sent'
      when dropped_at is not null then 'failed'
      else 'queued'
    end as state
  from notifications
  where user_id = auth.uid();

grant select on my_notifications to authenticated;

-- ------------------------------------------------------------------
-- The row policy the view leans on.
--
-- security_invoker means this runs with the caller's rights, so `notifications`
-- needs a policy of its own or the view returns nothing. Select only: nobody
-- may write their own notification history, and it is scoped to the recipient
-- rather than to a booking — a host and a practitioner on the same booking get
-- different messages, and each sees theirs.
-- ------------------------------------------------------------------
drop policy if exists "notifications: read your own" on notifications;

create policy "notifications: read your own"
  on notifications for select
  using (user_id = auth.uid());

/*
 * Column by column, not the whole row.
 *
 * A blanket `grant select on notifications` would have made the view
 * decorative: the policy lets somebody read their own rows, so they could
 * simply query the table and get last_error, attempts and dedupe_key —
 * every field the view was written to keep back. The grant is the boundary;
 * the view is the presentation.
 *
 * dropped_at is here because the view derives 'failed' from it, and a
 * security_invoker view can only read what the caller may read.
 */
grant select (id, user_id, booking_id, kind, channel, sent_at, dropped_at, created_at)
  on notifications to authenticated;
