# Chat, review and notification release matrix

This is the release contract for the host ↔ practitioner communication work.
It records what is enforced automatically, what must be checked on physical
devices, and which production configuration must exist before merge/deploy.

## Non-negotiable privacy boundaries

- `messages` remains outside `supabase_realtime`; its rows contain
  `original_body` and must never be a Postgres Changes payload.
- Clients read message copy only through `messages_visible`.
- The private Realtime topic is exactly `booking:<uuid>:messages`. Its Broadcast
  payload contains only `message_id`; it is a refresh hint, never message data.
- Push copy never contains a message, address, access code, person identifier or
  booking identifier. Navigation carries an opaque `notifications.id`, resolved
  only after sign-in through the recipient's own RLS-scoped row.
- Transactional booking, payment, safety, chat and review messages never consult
  the marketing preference.

## Automated chat matrix

| Scenario | Expected result | Automated evidence |
|---|---|---|
| Stranger reads/sends in another booking | No booking oracle; request denied | `supabase/messaging.test.ts`, `src/app/api/messages/route.test.ts` |
| Unpaid booking sends | 409; no row | message route + DB trigger tests |
| Cancelled booking | History readable, composer closed, insert refused | messaging DB/API tests |
| Phone/email/link/social/payment detail | Recipient sees redacted copy; original stays server-only | `message-redaction.test.ts`, messaging DB tests |
| “Send me your number / Instagram / pay outside” | Request rejected before insert with protective explanation | redaction and message route tests |
| Normal logistics containing “signal”, “cash”, dates, prices or door codes | Message remains intact | redaction false-positive suite |
| Either party blocks | DB trigger refuses both directions; composer closes immediately and after reopen | messaging DB, block route and thread-state tests |
| Report | Server derives counterpart; no caller-selected target | report route tests |
| Concurrent block after preflight | DB refusal becomes a plain 409 | message route/DB enforcement |
| Message committed, runtime stops before notification | Same transaction already contains a recoverable job | durable job migration + worker tests |
| Worker crashes after outbox insert | Dedupe makes the retry semantic-once | notification outbox + message job tests |
| Realtime signal dropped/sleep | visibility, online and 30-second safe-view fallback converge | repository subscription tests + manual scenario |
| Thread opened | Incoming messages are marked read from server truth; unread badge clears locally | messaging RPC tests + UI flow |

## Review and reputation matrix

| Scenario | Expected result | Automated evidence |
|---|---|---|
| Completed + paid, within 30 days | Each side may submit once | `reviews.test.ts`, review service tests |
| Cancelled, unpaid, unfinished or expired window | Submission refused | review eligibility tests |
| Same account on both sides / self-review attempt | Refused in service and by DB author ≠ subject constraint | review service + schema tests |
| Caller supplies the other role's fields | Role and subject are derived; foreign fields ignored | review service tests |
| One review only | Sealed for 14 days; its existence does not move public rating or received-review count | review privacy DB tests |
| Both reviews submitted | Both release; first reviewer receives counterpart notification | review lifecycle tests |
| Counterpart silent for 14 days | Lone review releases and reviewer is notified | review lifecycle tests |
| Overall ≤ 3 | Human escalation created | review rules/service tests |
| Safety concern at any rating | Highest-priority safety escalation | review service tests |
| Contact/off-platform copy in review | Contact data removed; solicitation copy discarded | review service tests |
| Listing has fewer than 3 released room reviews | `New`; no average displayed | aggregate/review UI tests |
| Practitioner receives first released host review | Private first-review milestone can fire without leaking sealed review state | reputation count migration + privacy test |
| Session badges | Count only paid, completed, arm's-length sessions; ratings do not grant benefits | badge tests |

Ratings and badges are deliberately separate. Stars describe released experience;
badges recognize completed sessions and carry no pricing, ranking or payout benefit.
This makes review retaliation and self-booking unable to manufacture a commercial
advantage.

## Marketing boundary

- Marketing is default-off and requires `notify_offers = true`, a recorded
  `marketing_consent_at`, and no `marketing_unsubscribed_at`.
- Authenticated preference changes write their own consent evidence; clients
  cannot forge timestamps, source or unsubscribe token.
- The public one-click unsubscribe endpoint returns the same success for unknown
  tokens, changes marketing only, and explicitly preserves transactional mail.
- Lifecycle candidate policy covers incomplete onboarding, listed/no bookings,
  browsed/no booking, first-booking follow-up, rebooking, dormancy and host
  inventory engagement. It does **not** send: a future marketing-only outbox must
  add campaign dedupe/frequency caps and re-check consent at claim time.

## Physical-device push matrix

Run with two real accounts and a real completed/confirmed booking.

| Platform state | iOS | Android | Pass condition |
|---|---:|---:|---|
| Foreground message | ☐ | ☐ | OS presentation remains visible/audible; in-app data refreshes; no duplicate body |
| Background message | ☐ | ☐ | Default sound/haptic obeys OS settings; badge/dot appears |
| Killed/cold launch tap | ☐ | ☐ | Sign-in if needed, then exact booking thread opens |
| Warm tap | ☐ | ☐ | Exact thread opens; Back returns normally |
| Review prompt tap | ☐ | ☐ | Correct role/booking review form opens |
| Invalid/old opaque token | ☐ | ☐ | Generic Notifications screen; no booking disclosure |
| Block from second device | ☐ | ☐ | Open composer disables on safe refresh; send race receives plain closed state |
| Read thread | ☐ | ☐ | In-app unread count clears; iOS badge follows OneSignal open behavior |
| Notifications disabled in OS | ☐ | ☐ | In-app history and unread state still work; no repeated permission trap |

iOS archives must contain `OneSignalNotificationServiceExtension` and both the
app and extension provisioning profiles must include
`group.com.minimumstress.app.onesignal`. The Codemagic release job fails early if
either profile is missing. Android still requires a real-device pass because an
AAB/emulator cannot prove OEM notification-channel sound, vibration or launcher
badge behavior.

## Production rollout order

1. Apply migrations through `20260916052000_reputation_review_count.sql`.
2. Confirm `messages` is still absent from `supabase_realtime` publication.
3. Confirm the private Broadcast policy exists on `realtime.messages`.
4. Deploy the web/API build with `CRON_SECRET`, OneSignal and Resend secrets.
5. Exercise `/api/cron/notifications` once and confirm all stages return 200.
   The current no-cost Vercel schedule also recovers jobs through `/api/cron`
   at 03:00 and 15:00 UTC. The request `after()` path remains the immediate
   delivery path; on a plan or scheduler that supports frequent runs, call the
   dedicated notification route every five minutes to tighten rare crash
   recovery without changing delivery semantics.
6. Configure the Apple App Group plus main/extension App Store profiles; run the
   Codemagic archive.
7. Complete the physical-device table above before rollout beyond internal/test
   distribution.
8. Check notification job/outbox retry counts and review escalations after the
   first live sessions. Do not add `messages` to raw Realtime as a shortcut.
