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
| ⬜ M2 | Supabase schema, RLS, auth — *needs Supabase keys* |
| ⬜ M3 | All screens ported and wired to real data |
| ⬜ M4 | Stripe Connect, manual-capture PaymentIntents, webhooks — *needs Stripe keys* |
| ⬜ M5 | Scheduled jobs: session-time capture, access code reveal |
| ⬜ M6 | Resend transactional email — *needs Resend key and DNS* |
| ⬜ M7 | Vercel deploy, then point minimumstress.app |

## Running it

```bash
npm install
npm run dev     # http://localhost:3000 — foundation preview
npm test        # the money and availability invariant suites
```

The preview at `/` is a review surface, not a product screen. It has three tabs: a live All In
Price calculator driven by the real pricing module, the weekly availability editor, and the brand
marks with the locked taxonomy.

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

## Layout

```
src/lib/money.ts          pricing, cancellation outcomes, credit redemption
src/lib/availability.ts   weekly template, validation, slot generation
src/lib/taxonomy.ts       the four locked categories and listing vocabulary
src/components/           brand marks, primitives, schedule editor, uploads, map
```
