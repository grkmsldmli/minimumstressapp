import Link from "next/link";

import { APP_URL, BRAND, LEGAL_ENTITY, SUPPORT_EMAIL } from "@/lib/company";
import { type LegalScope, sectionsFor } from "@/lib/legal-text";
import { effectiveDateLabel } from "@/lib/terms";

/**
 * The published version of the terms, as a document rather than a screen.
 *
 * The in-app screen folds each section behind a heading, which is right there:
 * somebody who has already agreed is looking for one clause. This is the
 * opposite audience — a person deciding whether to trust the app at all, and a
 * reviewer at Google checking the policy exists before they will show our name
 * on a sign-in screen. Both need it open, readable and reachable without an
 * account, so nothing here collapses and nothing needs JavaScript.
 *
 * Server-rendered for the same reason: a policy that only appears after
 * hydration is a policy a crawler records as an empty page.
 */
export function LegalDocument({
  scope,
  title,
  intro,
}: {
  scope: LegalScope;
  title: string;
  intro: string;
}) {
  const sections = sectionsFor(scope);

  return (
    <main className="min-h-full bg-white">
      <header
        className="px-6 py-12 relative overflow-hidden"
        style={{ background: "radial-gradient(130% 130% at 20% 0%, #1E4066 0%, #16304E 80%)" }}
      >
        <div className="mx-auto" style={{ maxWidth: 720 }}>
          <Link
            href="/"
            className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] text-white/60"
          >
            {BRAND}
          </Link>
          <h1 className="font-display italic font-semibold text-white mt-3 text-[30px] leading-tight">
            {title}
          </h1>
          <p className="font-body font-normal text-[14.5px] text-white/70 mt-3 leading-relaxed">
            {intro}
          </p>
        </div>
      </header>

      <div className="px-6 py-10">
        <div className="mx-auto" style={{ maxWidth: 720 }}>
          {sections.map((section) => (
            <section key={section.key} className="mb-9">
              <h2 className="font-display italic font-semibold text-[21px] text-navy mb-3">
                {section.title}
              </h2>
              <ul className="flex flex-col gap-2.5">
                {section.points.map((point) => (
                  <li key={point} className="flex items-start gap-2.5">
                    <span
                      className="w-1 h-1 rounded-full mt-2.5 shrink-0"
                      style={{ backgroundColor: "#8CA3BD" }}
                    />
                    <p className="font-body font-normal text-[15px] leading-relaxed text-ink-muted">
                      {point}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <div className="h-px my-8" style={{ backgroundColor: "#E7EEF6" }} />

          {/*
            Who the agreement is with, and where to write. A policy that names
            no entity and offers no address is one nobody can act on — which is
            the same reason company.ts exists as a single constant.
          */}
          {/*
            The date, not the number. The acceptance version is internal
            metadata — it decides who is re-asked, not something a reader needs —
            and "in effect since" is the ordinary way to date a document.
          */}
          <p className="font-body font-normal text-[13.5px] leading-relaxed text-ink-soft">
            {title} for {BRAND}, operated by {LEGAL_ENTITY}. In effect since {effectiveDateLabel()}.
          </p>
          <p className="font-body font-normal text-[13.5px] leading-relaxed text-ink-soft mt-2">
            Questions about this document go to{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-sky-text">
              {SUPPORT_EMAIL}
            </a>
            .
          </p>

          <nav className="flex flex-wrap gap-x-5 gap-y-2 mt-6">
            <Link href="/terms" className="font-body text-[13.5px] text-sky-text">
              Terms of Service
            </Link>
            <Link href="/privacy" className="font-body text-[13.5px] text-sky-text">
              Privacy Policy
            </Link>
            <a href={APP_URL} className="font-body text-[13.5px] text-sky-text">
              Open the app
            </a>
          </nav>
        </div>
      </div>
    </main>
  );
}
