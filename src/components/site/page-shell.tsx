import Link from "next/link";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { Reveal } from "@/components/site/reveal";
import { COLOUR, TYPE } from "@/lib/site-theme";

/**
 * The shape every written page here shares.
 *
 * Five arrived at once — pricing, trust, questions, contact, privacy choices —
 * and the first two had already drifted apart on heading size and top margin
 * before the third was written. That is how a site starts feeling assembled: a
 * page at a time, each nearly the same.
 */

export function PageShell({
  eyebrow,
  title,
  standfirst,
  children,
}: {
  eyebrow: string;
  title: React.ReactNode;
  standfirst: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader />

      {/* The page measure is the site measure. The reading column sits
          inside it and starts where the logo starts, so nothing shifts on
          the way from one page to the next. */}
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-4">
        <div className="max-w-3xl">
        <p className={TYPE.eyebrow} style={{ color: COLOUR.link }}>
          {eyebrow}
        </p>
        <h1
          className={`mt-4 ${TYPE.h2}`}
          style={{ fontFamily: "var(--font-dm-serif)", color: COLOUR.ink }}
        >
          {title}
        </h1>
        <p className={`mt-5 ${TYPE.lead}`} style={{ color: COLOUR.body }}>
          {standfirst}
        </p>

          {children}
        </div>
      </main>

      <SiteFooter />
    </>
  );
}

/** A block with a heading, which is most of what these pages are. */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Reveal>
      <section className="mt-14">
        <h2 className={TYPE.h3} style={{ color: COLOUR.ink }}>
          {title}
        </h2>
        <div className={`mt-3 space-y-4 ${TYPE.body}`} style={{ color: COLOUR.body }}>
          {children}
        </div>
      </section>
    </Reveal>
  );
}

/**
 * A number worth putting on its own, and the sentence that qualifies it.
 *
 * Every figure on these pages is read off the code rather than typed — the fee
 * from SERVICE_FEE_RATE, the windows from money.ts — because a pricing page
 * that disagrees with checkout is worse than no pricing page.
 */
export function Figure({
  value,
  label,
  note,
}: {
  value: string;
  label: string;
  note?: string;
}) {
  return (
    <div className="rounded-2xl p-5" style={{ border: `1px solid ${COLOUR.line}` }}>
      <p
        className="text-[34px] leading-none"
        style={{ fontFamily: "var(--font-dm-serif)", color: COLOUR.ink }}
      >
        {value}
      </p>
      <p className={`mt-2 font-medium ${TYPE.small}`} style={{ color: COLOUR.ink }}>
        {label}
      </p>
      {note && (
        <p className={`mt-1.5 ${TYPE.small}`} style={{ color: COLOUR.muted }}>
          {note}
        </p>
      )}
    </div>
  );
}

/** A question and its answer, used on more than one of these pages. */
export function QA({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className={`font-medium ${TYPE.body}`} style={{ color: COLOUR.ink }}>
        {q}
      </dt>
      <dd className={`mt-2 ${TYPE.body}`} style={{ color: COLOUR.body }}>
        {children}
      </dd>
    </div>
  );
}

export function Onward({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`mt-8 inline-block rounded-full px-8 py-4 font-medium text-white ${TYPE.small}`}
      style={{ backgroundColor: COLOUR.ink }}
    >
      {children}
    </Link>
  );
}
