import type { Metadata } from "next";

import { LegalDocument } from "@/components/legal-document";

/**
 * The privacy policy, at an address anybody can open.
 *
 * Required before Google will verify the OAuth consent screen, which is what
 * decides whether somebody signing in sees our name or a random Supabase
 * subdomain — and a person who cannot tell whose sign-in page they are on is
 * right to close the tab.
 */
export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What Minimum Stress collects, what it does with it, and what it never does with it.",
  alternates: { canonical: "/privacy" },
};

export default function Privacy() {
  return (
    <LegalDocument
      scope="privacy"
      title="Privacy Policy"
      intro="What we collect, what we do with it, and what we never do with it. The same text the app shows you before you agree to it."
    />
  );
}
