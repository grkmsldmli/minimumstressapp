import Link from "next/link";
import type { Metadata } from "next";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { BRAND } from "@/lib/company";
import { type Tool, liveToolsOfKind } from "@/lib/tools";

/**
 * The Wellness Hub.
 *
 * Six tools on one quiet page, in the two groups that actually differ to the
 * person using them: the ones that ask you questions and email you the result,
 * and the ones that answer instantly and ask for nothing.
 *
 * The old version of this page opened with a gradient banner counting "10 free
 * tools · 7 assessments · 3 calculators". Numbers about ourselves. What the
 * reader wants to know is which one to press, so the page is a list of names
 * and one honest line each.
 */

export const metadata: Metadata = {
  title: "Free wellness tools",
  description:
    "Six free tools: three assessments that score what you tell us about your week, and " +
    "three calculators that answer instantly. No account, no charge.",
};

export default function ToolsPage() {
  return (
    <>
      <SiteHeader />

      <main className="mx-auto max-w-5xl px-6 pb-24 pt-6">
        <h1
          className="max-w-lg text-[40px] leading-[1.08] sm:text-[48px]"
          style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
        >
          Free tools, and
          <br />
          <em className="italic" style={{ color: "#0EA5E9" }}>
            what to do with the answer.
          </em>
        </h1>

        <p className="mt-5 max-w-xl text-[16.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
          None of these is a diagnosis. They score what you tell us about your own week and give
          you somewhere sensible to start. Free, and no account.
        </p>

        <Group
          title="Assessments"
          note="You answer, we score it, and the full result comes by email."
          tools={liveToolsOfKind("assessment")}
        />

        <Group
          title="Calculators"
          note="Arithmetic. The answer is on the screen the moment you press it."
          tools={liveToolsOfKind("calculator")}
        />

        <Disclaimer />
      </main>

      <SiteFooter />
    </>
  );
}

/* ------------------------------------------------------------------ */

function Group({ title, note, tools }: { title: string; note: string; tools: Tool[] }) {
  // Nothing to head. An empty "Assessments" with white space under it reads
  // as a page that failed to load rather than one still being written.
  if (tools.length === 0) return null;

  return (
    <section className="mt-16">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-[24px]" style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}>
          {title}
        </h2>
        <p className="text-[14.5px]" style={{ color: "#8a94a3" }}>
          {note}
        </p>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {tools.map((tool) => (
          <ToolCard key={tool.slug} tool={tool} />
        ))}
      </div>
    </section>
  );
}

function ToolCard({ tool }: { tool: Tool }) {
  return (
    <Link
      href={`/tools/${tool.slug}`}
      className="flex flex-col rounded-2xl bg-white p-6 transition-colors"
      style={{ border: "1px solid #e7eef6" }}
    >
      <span className="text-[11px] uppercase tracking-[0.14em]" style={{ color: "#0EA5E9" }}>
        {tool.minutes}
      </span>

      <h3
        className="mt-2 text-[19px] leading-snug"
        style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
      >
        {tool.name}
      </h3>

      <p className="mt-2 flex-1 text-[14.5px] leading-[1.7]" style={{ color: "#5f6673" }}>
        {tool.blurb}
      </p>

      <span className="mt-4 text-[14px] font-medium" style={{ color: "#0F2F55" }}>
        Start →
      </span>
    </Link>
  );
}

/**
 * Said once, at the bottom, in plain words.
 *
 * The old pages each carried a folded-away "Disclaimer & Important
 * Information" button in grey-on-grey at ten percent contrast. A disclaimer
 * nobody can read is not a disclaimer; it is a place to point at afterwards.
 */
function Disclaimer() {
  return (
    <p
      className="mt-16 rounded-2xl p-6 text-[14px] leading-[1.75]"
      style={{ backgroundColor: "#f8fbfd", border: "1px solid #e7eef6", color: "#5f6673" }}
    >
      These tools are for information, not medical advice. They score self-reported answers and
      are not clinical measurements — nothing here diagnoses, treats, or rules anything out.{" "}
      {BRAND} is not a medical provider. If something worries you, see a doctor.
    </p>
  );
}
