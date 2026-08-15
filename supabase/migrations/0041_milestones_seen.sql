-- Which moments somebody has already been shown.
--
-- badges.ts starts at a hundred sessions and its card renders nothing below
-- twenty-five, so a host publishes a listing, lets a stranger into their
-- building, holds a session and reads their first review with the app saying
-- nothing to them for a year. milestones.ts fills that stretch.
--
-- Whether a milestone is *earned* is derived from rows that already exist —
-- bookings, reviews, payouts — and never stored, so it cannot drift from the
-- truth or be granted by writing a row. What has to be stored is narrower:
-- whether the person has already seen it, so the one full-screen moment does
-- not reappear every time they open the app.
--
-- A text array rather than a table. There are eleven possible values, they are
-- append-only, and the question asked of them is always "is this one in the
-- list" — a join would be ceremony around a set membership test.
--
-- Nothing here grants anything. These are recognition only: no fee changes, no
-- limits lifted, no queue positions. badges.ts records what happened the last
-- time tiers carried real benefits, and the reason it was taken out.

alter table profiles
  add column if not exists milestones_seen text[] not null default '{}';

/*
 * The host may write it, because dismissing a card is their own action and
 * nothing downstream reads this for money or access. 0019 revoked the blanket
 * update on `spaces` and re-granted per column; `profiles` is governed by the
 * row policy in 0002 instead, which already restricts a write to the row whose
 * id is auth.uid(). So there is no column list to add to here — but the
 * absence is worth stating, since the next person will look for one.
 */
