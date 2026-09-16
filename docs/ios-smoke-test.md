# iOS smoke test — Minimum Stress

Short, executable pass on a real iPhone (or the iOS Simulator) running the
Capacitor shell against production. Do it before every TestFlight/App Store build.
Tick each; note anything that shows a blank WebView, a raw error, or a browser
artifact.

## Launch & auth
- [ ] Fresh install → launch shows the brand splash, then the app (no white/blank
      WebView, no Safari chrome).
- [ ] Sign in with email one-time code (native shows email only — no social buttons).
- [ ] Kill the app during sign-in, reopen → no crash; can complete or restart sign-in.
- [ ] Deep link to a space (`minimumstress.app?space=<id>`) while signed out →
      after sign-in, lands on that Space Detail; invalid id → Discover, no leak.
- [ ] Session persists across app restart (no re-login needed).
- [ ] Log out → back to splash; Back cannot re-enter a signed-in screen.

## Core browse & book
- [ ] Discover loads; card images are the small optimized thumbnails (fast), not
      full-size originals.
- [ ] Deny location → the manual ZIP/postcode entry path still sorts spaces.
- [ ] Open Space Detail → gallery swipes; first image eager, rest lazy; only a
      coarse area is shown (no exact address pre-booking).
- [ ] Start a booking → the payment sheet appears (do not complete a live charge in
      review; use Stripe test mode).
- [ ] Cancel a booking (test data) → status and any refund copy update correctly.

## Messaging safety (Guideline 1.2)
- [ ] Open a confirmed booking's thread → shield/Flag button top-right.
- [ ] A second signed-in device sends a message → it appears without exposing a
      raw `messages` payload; unread state clears after the thread is read.
- [ ] Try “send me your number”, “continue on WhatsApp”, and “pay outside” → each
      is refused with an explanation; a normal sentence containing “signal” or
      “cash” still sends.
- [ ] Send an actual phone/email → the other side sees only the redacted copy.
- [ ] Report → sends; confirmation shown; no address/code required in the report.
- [ ] Block → confirms; after blocking, the composer is closed but the booking's
      address/door code remain available on the booking screen.

## Push and notification navigation
- [ ] Confirm the archive embeds `OneSignalNotificationServiceExtension` and the
      app + extension use `group.com.minimumstress.app.onesignal`.
- [ ] Foreground push → banner/default sound appears and in-app badges refresh.
- [ ] Background push → default sound/haptic and app badge appear (subject to the
      phone's Focus, silent-mode and per-app settings).
- [ ] Kill the app, tap a new-message push → after sign-in it opens that exact
      booking thread, never another account's booking.
- [ ] Tap a review-request push/email → it opens the correct booking and reviewer
      side; an expired/invalid token falls back to Notifications.

## Account & Pro
- [ ] Settings/Profile → "Delete account" is present, confirms, scrubs data, and
      logs out; reopening does not restore a usable session.
- [ ] Go Pro → opens Stripe checkout in **the system browser (Safari)**, not inside
      the app WebView.
- [ ] Return to the app after (simulated) purchase → on resume, Pro state reflects
      server truth (no client-granted Pro).

## Platform behavior
- [ ] Background the app and resume → data refreshes; no stale/blank screen.
- [ ] External links (legal/support, Stripe) open in Safari and return cleanly.
- [ ] Rotation / keyboard / safe areas: composer and headers respect the notch and
      home indicator; keyboard does not cover the message input.
- [ ] Airplane mode / server unreachable → a clear offline/error state, not a blank
      WebView; recovers when back online.
- [ ] No console errors on the production site in the WebView (check via Safari Web
      Inspector attached to the device).
