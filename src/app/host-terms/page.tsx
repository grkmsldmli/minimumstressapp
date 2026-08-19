import type { Metadata } from "next";

import { HostTermsDocument } from "@/components/host-terms-document";

/**
 * The Host Terms, at an address anybody can open.
 *
 * A host accepts these once before their first listing, against this exact
 * text with a version and a timestamp. The acceptance checkbox links here, and
 * both read the same HOST_TERMS_SECTIONS array, so there is no second copy to
 * drift out of date.
 */
export const metadata: Metadata = {
  title: "Host Terms",
  description:
    "The agreement for listing a space on Minimum Stress: the right to offer it, permitted use, how you are paid, and what you remain responsible for.",
  alternates: { canonical: "/host-terms" },
};

export default function HostTerms() {
  return <HostTermsDocument />;
}
