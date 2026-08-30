# App Privacy — App Store Connect answers (Minimum Stress)

Grounded in the codebase, not guessed. Fill the App Store Connect **App Privacy**
questionnaire with the answers below.

## Headline answers
- **Does the app collect data?** Yes.
- **Does the app use data to track you (ATT)?** **No.** There is no advertising
  SDK, no IDFA access, no cross-app/website tracking, and no third-party analytics
  in the client. Do **not** add an ATT prompt.
- **Is collected data linked to the user's identity?** Yes for account data (it is
  a signed-in marketplace).

## Who processes what
- **Minimum Stress** (via **Supabase** Postgres/Storage as its processor): account,
  profile, listings, bookings, messages, saved ZIP, and the Stripe/Connect
  identifiers it stores.
- **Stripe** (independent processor): card/payment details, host payout/bank
  details (Stripe Connect), and identity-verification documents (Stripe Identity).
  Minimum Stress stores only Stripe identifiers and a pass/fail verdict — never
  card numbers, bank numbers, or the ID document/selfie.
- **Resend**: delivers transactional email (receives the email address).
- **Google Places** (geocoding): receives a ZIP or place text to turn it into
  coordinates for distance sorting. Not stored by the provider on our behalf.

## Per-category questionnaire answers

| Data type | Collected | Linked to user | Tracking | Purpose | Processed by |
|---|---|---|---|---|---|
| Email address | Yes | Yes | No | App Functionality (sign-in code), Customer Support | MS/Supabase, Resend |
| Name (display name) | Yes | Yes | No | App Functionality | MS/Supabase |
| Photos (profile avatar; listing photos/video) | Yes | Yes | No | App Functionality | MS/Supabase (private bucket, signed URLs) |
| Coarse location (search area) | Yes | Yes | No | App Functionality (sort spaces by distance) | MS (device coords used then dropped; ZIP saved as a preference), Google Places |
| Precise location | **No** | — | — | The device's precise coordinates are used in-memory to sort and are never written down; only a coarse label is stored | — |
| Physical address (host's own listing address) | Yes | Yes | No | App Functionality (revealed to a booker only after a confirmed booking) | MS/Supabase |
| Sensitive info — govt ID / identity docs | Yes | Yes | No | App Functionality (fraud prevention / verification) — collected and processed **by Stripe Identity**; MS receives only a verdict | Stripe |
| Other user content — messages | Yes | Yes | No | App Functionality (coordinate a confirmed booking); contact details are auto-redacted | MS/Supabase |
| Other user content — professional proof / insurance docs | Yes | Yes | No | App Functionality (professional verification) | MS/Supabase (private bucket) |
| Purchase history / booking history | Yes | Yes | No | App Functionality | MS/Supabase; payments via Stripe |
| Payment info | Yes | Yes | No | App Functionality — entered into and held **by Stripe**; MS stores only identifiers | Stripe |
| Customer support | Yes | Yes | No | Customer Support (emails to support) | MS, Resend |
| Identifiers — user ID | Yes | Yes | No | App Functionality | MS/Supabase |
| Identifiers — device ID / advertising ID | **No** | — | No | — | — |
| Diagnostics / usage / crash | **No** custom collection | — | No | Hosting infrastructure logs (Vercel/Supabase) may retain standard request logs; no analytics SDK in the app | Infra |

## Notes for the reviewer of this label
- The private `space-media` bucket means listing photos are served only through
  short-lived signed URLs to signed-in users — they are not publicly downloadable.
- "Sensitive info" is answered Yes because Stripe Identity collects a government ID
  and selfie on our behalf; that data lives with Stripe, and MS stores only the
  outcome. Declare it under Stripe's processing, purpose "App Functionality / Fraud
  Prevention," not linked to marketing.
- The public Privacy Policy at `https://minimumstress.app/privacy` must match this
  table. Verify it names Supabase, Stripe, Resend, and the geocoding provider, and
  states that precise location is not retained. If it does not, update the policy
  before submission (see the report's manual steps).
