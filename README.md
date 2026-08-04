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
| ✅ M2a | Schema, RLS and storage policies, written and verified against real Postgres |
| ✅ M3 | Every screen ported, running against an in-memory repository |
| ⬜ M2b | Point the repository at a live Supabase project — *needs Supabase keys* |
| ⬜ M4 | Stripe Connect, manual-capture PaymentIntents, webhooks — *needs Stripe keys* |
| ⬜ M5 | Scheduled jobs: session-time capture, access code reveal |
| ⬜ M6 | Resend transactional email — *needs Resend key and DNS* |
| ⬜ M7 | Vercel deploy, then point minimumstress.app |

The whole app runs today. `src/lib/repository.ts` is the seam: screens talk to
that interface, `MockRepository` implements it in memory, and connecting
Supabase means writing a second implementation without touching a component.

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

`supabase/migrations/` holds the schema, RLS policies and storage rules. They have not been applied
to a live project yet, but they are not unverified: `supabase/schema.test.ts` and
`supabase/rls.test.ts` execute them against real Postgres (PGlite, compiled to WASM) and then query
as `anon` and as two different signed-in users to prove the boundaries hold.

The organising rule, because getting it wrong is how an address leaks:

- **Base tables are owner-only.** `anon` cannot reach them at all.
- **Public data goes through security *definer* views**, whose safety is the column list — the
  address and Stripe identifiers are absent, not merely unselected.
- **Per-user data goes through security *invoker* views**, so row policies still apply.
- **The address is a security definer function** that checks for a booking itself, because a
  practitioner has no row policy on `spaces` and granting one would expose the host's lease document.

`0000_supabase_stubs.sql` stands in for what Supabase provides locally and is excluded from the
migrations the tests treat as real.

## Layout

```
src/lib/money.ts          pricing, cancellation outcomes, credit redemption
src/lib/availability.ts   weekly template, validation, slot generation
src/lib/taxonomy.ts       the four locked categories and listing vocabulary
src/lib/repository.ts     the data boundary; mock-repository.ts implements it
src/components/screens/   every screen, one file per flow
supabase/migrations/      schema, RLS, storage
```
