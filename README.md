# Minimum Stress

A two-sided marketplace: independent wellness practitioners who need a private room by the hour,
matched with studios that have unused hours to rent out.

Separate from minimumstress.com, which is an unrelated Shopify storefront.

## Status

Deployed and running. The database, payments, payouts, addresses and email are
all wired to real services and verified against them; what remains is mostly
DNS and a scheduler.

| | |
|---|---|
| ✅ M0 | Next.js scaffold, brand tokens, fonts, shared UI primitives |
| ✅ M1 | Money module and its invariant test suite |
| ✅ M2 | Schema, RLS and storage policies — applied to the live project and verified against it |
| ✅ M3 | Every screen ported, running against an in-memory repository |
| ✅ M4a | Stripe payment layer, verified end to end in the sandbox |
| ✅ M4b | Server-side booking and cancellation, with pricing the client cannot influence |
| ✅ M4c | Route handlers, the payment sheet, and both webhook endpoints |
| 🔶 M5 | Capture runs daily, which is all Hobby allows — see Scheduled jobs |
| ✅ M6 | Resend on a verified domain, carrying both our mail and Supabase's login codes |
| 🔶 M7 | Deployed and verified at minimumstressapp.vercel.app; minimumstress.app not yet pointed |

`src/lib/repository.ts` is the seam: screens talk to that interface,
`MockRepository` implements it in memory, `SupabaseRepository` against the real
database. **The mock is still the one wired up** — see `repository-factory.ts`
for why, and flip `NEXT_PUBLIC_USE_SUPABASE=true` once the auth screens create
real accounts. That is the largest remaining piece of work.

## Running it

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # 286 tests: money, availability, geo, repository, schema, RLS, webhook
```

Start at the splash screen and pick either role. Nothing is seeded for *you* — no listings, no
bookings, no credit — so every empty state is a real one. Other hosts' rooms are seeded, because a
marketplace with nothing in it cannot be reviewed.

Two buttons are labelled "Prototype only": approving a listing, and simulating an inbound booking.
They stand in for the manual review and for real practitioner demand, and both disappear once
there is a backend.

## The money rules

`src/lib/money.ts` holds every calculation, as pure functions over integer cents. Two guarantees
hold for all inputs, and `money.test.ts` exists to prove it across a full grid of rates, tiers and
credit balances:

1. **The host receives exactly the rate they set.** Nothing is deducted from it — not the service
   fee, not a Pro discount, not goodwill credit.
2. **The platform's cut never falls below Stripe's processing fee**, so a heavily credited booking
   costs us nothing rather than real cash.

Fixed constants: a 20% service fee added on top of the host rate, a flat $5 fee on slots starting
within two hours, and a Pro tier at $9.90/month that waives instant fees and takes 10% off the
all-in total.

Two decisions the brief left open, resolved in code and documented at the call site:

- **Pro's discount is not floored, but credit redemption is.** Pro is a paid entitlement, so
  advertising 10% and delivering less would be the worse failure; credit is goodwill, so partial
  redemption with the remainder rolled over stays honest and keeps us cash-positive.
- **When a host cancels, goodwill credit equals the platform's *net* take**, and any credit already
  spent is restored separately. Refunding the gross fee as fresh credit would mint liability we
  never earned. With no credit involved this is identical to the brief's plain reading.

## The database

`supabase/migrations/` holds the schema, RLS policies and storage rules, and
`supabase/apply.sql` is all of them concatenated for the SQL editor. Safe to run
more than once — every statement is guarded, so applying it to a project that
already has some of it is dull rather than a transaction that aborts halfway.

`schema.test.ts` and `rls.test.ts` execute the migrations against real Postgres
(PGlite, compiled to WASM), then query as `anon` and as two different signed-in
users to prove the boundaries hold. One test applies the whole set twice, which
is the only thing that catches `create or replace view` refusing to drop a
column.

The organising rule, because getting it wrong is how an address leaks:

- **Base tables are owner-only.** `anon` cannot reach them at all.
- **Public data goes through security *definer* views**, whose safety is the column list — the
  address and Stripe identifiers are absent, not merely unselected.
- **Per-user data goes through security *invoker* views**, so row policies still apply.
- **The address is a security definer function** that checks for a booking itself, because a
  practitioner has no row policy on `spaces` and granting one would expose the host's lease document.

`0000_supabase_stubs.sql` stands in for what Supabase provides locally and is excluded from the
migrations the tests treat as real.

## Scheduled jobs

`/api/cron` captures payment for sessions that have already started. It is
driven by comparing database state to the clock — "what is due and unhandled"
rather than "what became due since I last ran" — so a missed run self-heals on
the next one, and running it twice is harmless.

It is scheduled daily, because Vercel's Hobby plan rejects any deployment whose
cron runs more often. That is workable but not ideal: a booking is captured
within 24 hours of its session rather than at it. Nothing expires — card
authorisations last about seven days — but a host waits up to a day longer than
they need to.

Three ways to make it timely, in the order they cost:

1. **Any external scheduler** hitting the endpoint every few minutes with
   `Authorization: Bearer $CRON_SECRET`. Free, and the endpoint is already
   built for it.
2. **Supabase `pg_cron` + `pg_net`**, so the database triggers it. No third
   party holding the secret.
3. **Vercel Pro**, which lifts the restriction and needs no extra moving parts.

Revealing access codes deliberately needs none of this: a booking stores its own
`access_code_revealed_at` and the view withholds the code until that moment
passes, so it opens on time whether or not anything is running.

## Addresses and the two maps

A host types an address and picks it from a dropdown; the choice carries real
coordinates, which drop the pin on a real map of their own street. It is proxied
through `/api/geocode` so a host's home address does not leave their browser for
a third party, and so the provider is one file.

**Two things happen to the query before it is sent**, both arrived at by
measuring a live geocoder rather than guessing. US abbreviations are expanded —
"1301 w hillsdale blv" returned an alley in Sacramento, and the spelled-out form
found the right street in San Mateo. And results carrying the house number that
was typed are moved to the top, because an OSM-derived provider will happily
rank a street called "Hillsdale Blvd Walerga Road Alley" above the building
someone gave the number of.

**Provider quality is a real constraint, not a detail.** Three are supported,
and which one is configured changes what the field can do:

| Key set | Provider | What it can answer |
|---|---|---|
| `GOOGLE_PLACES_API_KEY` | Google Places | Predicts from a few characters, tolerates typos, knows business names |
| `LOCATIONIQ_API_KEY` | LocationIQ | Complete addresses, exactly |
| neither | Photon | Right street, often the wrong building |

The gap between the first two is not tuning. A geocoder answers "where is this
address" and is asked, on every keystroke but the last, about half of one:
measured through the app, `1301 w hillsd` resolved and `1301 w hillsdale` — the
same address, three characters longer — returned nothing, while `1301 w
hillsdale` alone landed in Lansing, Michigan. Places is a predictive engine and
answers the question the field is actually asking.

It costs two calls instead of one, because a prediction carries no coordinates
and a chosen place is exchanged for them afterwards. A session token ties the
keystrokes to that final lookup so the whole entry bills once rather than per
character; `AddressSuggestion.lat` is nullable to make the intermediate state
impossible to ignore, since defaulting it to zero would put an unresolved pin
in the Gulf of Guinea.

`scripts/check-geocoder.mjs` measures whichever provider is live, through
`/api/geocode` rather than against the provider directly — a green run against
the provider proves nothing about the one the app is configured to use.

The field stays authoritative throughout. A rural address the geocoder has never
heard of, or a geocoder that is simply down, costs a host the suggestions and
nothing else. Editing the text after choosing clears the pin, because the
coordinates belonged to the address that was picked.

**There are deliberately two maps, and only one of them is real.**

| | |
|---|---|
| `location-map.tsx` | Real OSM tiles. Host-only, showing them their own address. |
| `map.tsx` | An illustration. Everything a practitioner browses. |

The second is not a placeholder waiting to be upgraded. A listing's street
address is private until someone books it, so the map on Discover must not be a
locator — and `toBrowsePosition` reduces a coordinate to which ~11 km cell it
falls in before spreading that cell through an integer mix, so the picture
carries no bearing and no distance. Neighbouring studios land on the same spot,
which is exactly what makes the drawing unreadable backwards. `geo.test.ts`
asserts that property rather than trusting the comment.

`lat`/`lng` stay private, released only through `space_access_details` to
someone holding a booking. `map_x`/`map_y` — the coarse derived pair — are the
only position `anon` can select.

## Notifications

`src/lib/notify/messages.ts` holds every message as a pure function, so what
they *say* is tested without a provider, an API key or a network. That matters
more here than usual: the failure mode is not an exception anyone sees, it is a
correct delivery of the wrong number to a real person. The suite asserts that no
placeholder leaks into an inbox, that a host is never shown the platform's fee,
and that a released authorization is never described as a refund.

That last one was a real bug, caught by the build rather than by review. Payment
is authorised at booking and captured at session start, so the ordinary
cancellation returns nothing *because nothing was ever taken* — calling it a
refund would have people watching a statement for a credit that is not coming.
There are three outcomes, and only one of them is a refund.

Email is [Resend](https://resend.com). Until a domain is verified it sends only
from `onboarding@resend.dev` and only to the account owner, which is enough to
read every message in a real inbox — `scripts/send-test-email.mjs` does exactly
that.

**Sending is not transactional**, the same problem as the Stripe call in
`booking-service.ts`: no transaction spans Postgres and Resend. So `notifications`
carries a unique key per *(what, about what, which channel)*, claimed before the
send, and a retried job collides instead of sending twice. Delivery is
at-least-once rather than exactly-once, deliberately — a duplicate door code is
an annoyance, a missing one is someone locked out. The body is never stored: it
is rebuilt from live data on retry, which also keeps door codes out of a second
table.

SMS is reserved for two kinds — the door code, and a host cancelling on you —
because those are the only ones where hearing an hour later is too late. A
number is texted only when it is both verified and opted in; an unverified
number is somebody's typo until proven otherwise, and the wrong number is a
stranger receiving a door code. The transport is written and tested, but **US
SMS needs A2P 10DLC brand and campaign registration before a carrier will
deliver it** — that is a form and a wait, not a key.

## Payments

Destination charges with `capture_method: manual`. The practitioner is
authorised at booking and nothing moves until the session starts, which is what
makes 24-hour free cancellation possible rather than a refund policy.

`application_fee_amount` is written as total minus the host's rate, though the
two are equal, so the host's take is the subject of the arithmetic. Verified in
the sandbox: on a $45 rate for an instant slot the practitioner pays $59.00, the
host's balance shows exactly $45.00, Stripe takes $2.01 and $11.99 reaches us.

Worth knowing if you go looking in the dashboard: the platform's copy of the
charge reports `transfer.amount` as the full $59.00, which reads alarmingly like
the host being handed our fee too. The fee is deducted on the connected
account's side. That account's own ledger is the honest view.

## Layout

```
src/lib/money.ts           pricing, cancellation outcomes, credit redemption
src/lib/availability.ts    weekly template, validation, slot generation
src/lib/geo.ts             web mercator, tile grids, the browse-map projection
src/lib/geocode.ts         address lookup, and what a suggestion is made of
src/lib/notify/            what each message says, and the queue that sends it once
src/lib/taxonomy.ts        the four categories, listing and house-rule vocabulary
src/lib/booking-plan.ts    what may be booked, and for how much — pure, heavily tested
src/lib/booking-service.ts the same rules against the database and Stripe
src/lib/stripe/            payment intents, Connect onboarding, settlement
src/lib/repository.ts      the data boundary; mock and Supabase both implement it
src/components/screens/    every screen, one file per flow
supabase/migrations/       schema, RLS, storage
```
