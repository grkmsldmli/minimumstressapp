"use client";

import { loadStripe, type Stripe } from "@stripe/stripe-js";

/**
 * Stripe.js, loaded once per tab.
 *
 * The publishable key belongs in the browser — it can create and confirm
 * payment methods and nothing else. Amounts, fees and destinations are all
 * fixed server-side on the PaymentIntent before this ever runs, so there is
 * nothing here for a tampered client to change.
 */
let cached: Promise<Stripe | null> | null = null;

export function stripeBrowser(): Promise<Stripe | null> {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!key) {
    return Promise.reject(
      new Error("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set — see .env.example"),
    );
  }
  cached ??= loadStripe(key);
  return cached;
}

/** Card fields styled to match the rest of the app rather than Stripe's default. */
export const STRIPE_APPEARANCE = {
  theme: "flat" as const,
  variables: {
    colorPrimary: "#3B9BE8",
    colorBackground: "#FFFFFF",
    colorText: "#16304E",
    colorDanger: "#C05A4B",
    fontFamily: "var(--font-poppins), system-ui, sans-serif",
    fontSizeBase: "13px",
    borderRadius: "12px",
    spacingUnit: "3px",
  },
  rules: {
    ".Input": { border: "1px solid #DCE7F2", boxShadow: "none", padding: "12px" },
    ".Input:focus": { border: "1px solid #3B9BE8", boxShadow: "none" },
    ".Label": { color: "#6B84A0", fontWeight: "400" },
  },
};
