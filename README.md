# Minimum Stress Spaces

A two-sided marketplace: independent wellness practitioners who need a private room by the hour,
matched with studios that have unused hours to rent out.

Separate from minimumstress.com, which is an unrelated Shopify storefront.

## Status

Phase 1, milestones M0 and M1. The foundation is in place; nothing is wired to a database or a
payment processor yet.

| | |
|---|---|
| ✅ M0 | Next.js scaffold, brand tokens, fonts, shared UI primitives |
| ✅ M1 | Money module and its invariant test suite |
| ✅ M2 | Schema, RLS and storage policies — applied to the live project and verified against it |
| ✅ M3 | Every screen ported, running against an in-memory repository |
| ✅ M4a | Stripe payment layer, verified end to end in the sandbox |
| ✅ M4b | Server-side booking and cancellation, with pricing the client cannot influence |
| ⬜ M4c | Route handlers and the Embedded Components payment sheet |
| ⬜ M5 | Scheduled jobs: session-time capture, access code reveal |
| ⬜ M6 | Resend transactional email — *needs Resend key and DNS* |
| ⬜ M7 | Vercel deploy, then point minimumstress.app |

`src/lib/repository.ts` is the seam: screens talk to that interface,
`MockRepository` implements it in memory, `SupabaseRepository` against the real
database. The mock is still the one wired up, deliberately — see
`repository-factory.ts` for why, and flip `NEXT_PUBLIC_USE_SUPABASE=true` once
the payment routes land.

## Running it

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # 120 tests: money, availability, repository, schema, RLS
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
src/lib/taxonomy.ts        the four categories, listing and house-rule vocabulary
src/lib/booking-plan.ts    what may be booked, and for how much — pure, heavily tested
src/lib/booking-service.ts the same rules against the database and Stripe
src/lib/stripe/            payment intents, Connect onboarding, settlement
src/lib/repository.ts      the data boundary; mock and Supabase both implement it
src/components/screens/    every screen, one file per flow
supabase/migrations/       schema, RLS, storage
```
