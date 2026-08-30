# App Store Connect metadata — Minimum Stress (iOS v1)

Ready-to-paste values for App Store Connect. US storefront launch. Contemporary
American English. No "therapy" in public copy. Positioning: **Bring your clients.
Book only the space you need.**

Bundle ID (already set, do not change): `com.minimumstress.app`

---

## App information

- **App Name:** `Minimum Stress`
- **Subtitle (≤30 chars):** `Book pro space by the hour`
- **Primary Category:** Business
- **Secondary Category:** Lifestyle
- **Content Rights:** Does not use third-party content.

## Promotional Text (≤170 chars — editable without review)
```
Have clients. Need space? Find professional wellness and movement rooms near you and book them by the hour — no lease, no deposit, one all-in price.
```

## Description
```
Minimum Stress is where independent wellness and movement professionals book the space they need, by the hour, to see their own clients — without signing a lease.

Bring your clients. Book only the space you need.

FIND SPACE THAT FITS YOUR PRACTICE
Search professional rooms and studios near you — movement studios, private consultation rooms, and quiet rooms for coaching, meditation, breathwork, bodywork, small groups, classes, and workshops. Every listing shows one all-in hourly price, with the service fee already included.

BOOK BY THE HOUR
Pick the hour you need, inside the hours the host has opened. Pay securely in the app. No lease, no deposit, no paying for a room when you are not using it.

BUILT FOR PROFESSIONALS
Booking your first space requires identity verification, liability insurance, and proof of your profession — so hosts know who is coming into their room, and practitioners work alongside others who have done the same.

FOR HOSTS
Own a treatment room, studio, or spare consulting space? Put the hours it sits empty to work. Set your own rate and hours, keep your rate in full, and get paid to your bank after each session.

WHAT'S INSIDE
- Location-based discovery with approximate areas until a booking is confirmed
- Space details with photos, amenities, and what each room is suited for
- Secure in-app booking and payment
- Messaging with the other party about a confirmed booking
- Your bookings, standing, and history in one place
- Host dashboard: listings, calendar, and payouts

Minimum Stress is professional infrastructure for independent practice — not event rental, and not a directory. The exact address and entry details for a room are shared only after a booking is confirmed.
```

## Keywords (≤100 chars, comma-separated, no spaces)
```
wellness space,studio rental,treatment room,by the hour,movement,pilates,yoga,coaching,practitioner,rent
```

## URLs
- **Support URL:** `https://minimumstress.com/contact`
- **Marketing URL:** `https://minimumstress.com/for-practitioners`
- **Privacy Policy URL:** `https://minimumstress.app/privacy`

## Copyright
```
© 2026 Minimum Stress Consulting Services LLC
```

---

## App Review information

- **Sign-in required:** Yes. See "Reviewer account" below.
- **Contact:** provide a monitored email + phone in App Store Connect (App Review
  Information). Public support: `info@minimumstress.com`.

### App Review Notes (paste into "Notes")
```
WHAT THE APP IS
Minimum Stress is a two-sided marketplace. Practitioners (independent wellness/movement professionals) book professional space by the hour to see their own clients; hosts list unused space. The app is a native shell around our production web app (minimumstress.app), server-rendered by design.

BOOKING PAYMENTS ARE FOR REAL-WORLD SERVICES (Stripe)
Booking a room reserves physical space used off-app. These are payments for a real-world service, handled by Stripe, and are outside In-App Purchase per Guideline 3.1.3(e)/3.1.5. Host payouts run through Stripe Connect.

PRO SUBSCRIPTION (US storefront)
Pro is an optional US$9.90/month upgrade that unlocks in-app convenience (extended booking horizon). On iOS it is presented as an external purchase: tapping to subscribe opens Stripe checkout in the system browser (Safari), not an embedded webview. Pro status is granted only by our server after Stripe confirms payment; the app never grants Pro to itself.

VERIFICATION GATES
Anyone can install, sign in, browse spaces, and open a listing. Booking a FIRST session requires identity verification (Stripe Identity), liability insurance, and professional proof. Reviewers can see the full browse and booking-setup experience without completing verification; the gate appears at the booking step and is explained on screen.

SIGN IN
Email one-time code only on iOS (no third-party social login on the native app), so Guideline 4.8 does not apply. Enter the reviewer email below; we deliver a 6-digit code.

MESSAGING SAFETY (Guideline 1.2)
Messaging exists only between the two parties of a confirmed booking. Each thread has Report and Block (top-right shield icon). Reports are recorded for staff review; blocking severs the chat without affecting the booking. Support: info@minimumstress.com.

ACCOUNT DELETION (Guideline 5.1.1(v))
Profile → "Delete account" performs in-app deletion with confirmation. It scrubs user-facing personal data and signs the user out; only legally/financially required transaction records are retained.

TESTING PAYMENTS
Please do not complete a live charge. If you need to see the payment sheet, we can provide Stripe test-mode instructions on request — contact the review email above. We do not create fake production bookings.
```

### Reviewer account
```
Provide in App Store Connect (App Review Information → Sign-In Required):
- Email: reviewer@minimumstress.com  (set up a real, monitored mailbox before submission)
- The app sends a 6-digit code to this address; there is no password.
- This account is a practitioner and can browse all inventory. It is intentionally
  left un-verified so the reviewer can see the verification gate; on request we can
  pre-verify it in Stripe test mode so the booking/payment sheet can be exercised
  without a live charge.
```

## Required hardware / permissions
- iPhone, iOS 16+ (see `docs/app-store/age-rating.md` and native config for the
  final deployment target).
- Camera and Photo Library — only when a host adds listing photos or a user
  uploads a verification document (purpose strings in Info.plist).
- Location — optional; used to sort spaces by distance. Declining keeps the manual
  ZIP/postcode entry path.
- No push in v1 (email + in-app notifications). See PHASE 9 note in the report.

## Claims to avoid (do not put in any field)
- No "therapy" / medical treatment claims.
- No guaranteed clients, income, or room availability.
- No "instant fee waived" / fee-waiver copy.
- No claim that Minimum Stress certifies practitioner quality.
