import type { Metadata } from "next";

import { LegalDocument } from "@/components/legal-document";

/**
 * The terms, at an address anybody can open.
 *
 * Not a summary of terms kept elsewhere: acceptance is recorded against this
 * text with a version and a timestamp, and both this page and the in-app
 * screen read the same array in legal-text.ts so there is no second copy to
 * drift out of date.
 */
export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The agreement between you and Minimum Stress Consulting Services LLC: bookings, money, cancellations and safety.",
  alternates: { canonical: "/terms" },
};

export default function Terms() {
  return (
    <LegalDocument
      scope="terms"
      title="Terms of Service"
      intro="The agreement between you and us — what the marketplace does, what it does not, and what happens with money, cancellations and safety."
    />
  );
}
