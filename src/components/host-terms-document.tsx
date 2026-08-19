import Link from "next/link";

import { APP_URL, BRAND } from "@/lib/company";
import {
  HOST_TERMS_CONTACT,
  HOST_TERMS_ENTITY,
  HOST_TERMS_SECTIONS,
  HOST_TERMS_SUMMARY,
  HOST_TERMS_VERSION,
  hostTermsEffectiveLabel,
} from "@/lib/host-terms";

/**
 * The Host Terms as a published document, at an address anybody can open.
 *
 * The same shape and the same reasoning as LegalDocument: acceptance is
 * recorded against this exact text with a version and a timestamp, so it has
 * to be reachable without an account, open rather than collapsed, and rendered
 * on the server so a crawler — and a host deciding whether to list — reads the
 * whole agreement rather than an empty shell. The one array it renders,
 * HOST_TERMS_SECTIONS, is the same one the acceptance checkbox links to, so
 * there is no second copy to drift.
 */
export function HostTermsDocument() {
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
            Host Terms
          </h1>
          <p className="font-body font-normal text-[14.5px] text-white/70 mt-3 leading-relaxed">
            The agreement for listing a space on {BRAND} — the right to offer it, what it may be used
            for, how you are paid, and what you remain responsible for. Accepted separately from the
            Terms of Service, once, before your first listing.
          </p>
        </div>
      </header>

      <div className="px-6 py-10">
        <div className="mx-auto" style={{ maxWidth: 720 }}>
          {/*
            A plain-language summary before the wall of clauses, so a host sees
            the shape of what they are agreeing to in the first ten seconds. It
            is a reader's aid, not the agreement — HOST_TERMS_SUMMARY is
            deliberately outside the binding text and the digest — so it is set
            apart visually and labelled as a summary, with the full sections
            immediately below.
          */}
          <section
            className="mb-10 rounded-2xl p-5 sm:p-6"
            style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
          >
            <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] text-sky-text mb-3.5">
              Before you list
            </p>
            <ul className="flex flex-col gap-3">
              {HOST_TERMS_SUMMARY.map((point) => (
                <li key={point} className="flex items-start gap-3">
                  <span
                    className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                    style={{ backgroundColor: "#E3F0FB" }}
                    aria-hidden
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#2E7CC4"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </span>
                  <p className="font-body font-medium text-[15px] leading-snug text-navy">
                    {point}
                  </p>
                </li>
              ))}
            </ul>
            <p className="font-body font-normal text-[13px] leading-relaxed text-ink-soft mt-4">
              A plain-language summary. The full terms below are what you accept.
            </p>
          </section>

          {HOST_TERMS_SECTIONS.map((section) => (
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

          <p className="font-body font-normal text-[13.5px] leading-relaxed text-ink-soft">
            Host Terms for {BRAND}, operated by {HOST_TERMS_ENTITY}. Version {HOST_TERMS_VERSION}, in
            effect since {hostTermsEffectiveLabel()}. These are in addition to the{" "}
            <Link href="/terms" className="text-sky-text">
              Terms of Service
            </Link>
            , which apply to everyone.
          </p>
          <p className="font-body font-normal text-[13.5px] leading-relaxed text-ink-soft mt-2">
            Questions about this document go to{" "}
            <a href={`mailto:${HOST_TERMS_CONTACT}`} className="text-sky-text">
              {HOST_TERMS_CONTACT}
            </a>
            .
          </p>

          <nav className="flex flex-wrap gap-x-5 gap-y-2 mt-6">
            <Link href="/host-terms" className="font-body text-[13.5px] text-sky-text">
              Host Terms
            </Link>
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
