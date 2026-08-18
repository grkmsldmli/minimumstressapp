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
  title: "Assessments",
  description:
    "Assessments and calculators scored on the screen as you answer — no email, no account, " +
    "and nothing kept.",
};

export default function ToolsPage() {
  return (
    <>
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-6 pb-24 pt-6">
        {/*
          What these are, rather than what they cost.

          The page opened on "Free tools, and what to do with the answer",
          under it "None of these is a diagnosis". Two problems in three lines.
          "Free" is the word every content farm leads with, and leading on the
          price of something is an admission that the thing itself is not the
          argument. Then the first real sentence was a denial — the page told
          you what it was not before it had said what it was, which is how a
          reader decides it is probably worth nothing.

          What replaces it is the method. A named set of questions, scored
          against a stated model, on the screen. That is either interesting or
          it is not, and it is the same claim the disclaimer at the foot of the
          page makes — said once, in the affirmative, where somebody is
          deciding whether to start.
        */}
        <h1
          className="max-w-xl text-[34px] leading-[1.08] sm:text-[42px]"
          style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
        >
          Assessments,
          <br />
          <em className="italic" style={{ color: "#0EA5E9" }}>
            and how each one is scored.
          </em>
        </h1>

        <p className="mt-4 max-w-xl text-[16.5px] leading-[1.7]" style={{ color: "#33404F" }}>
          Each one asks a set of questions about your own week and scores them against a stated
          model, on the screen as you answer. No account, and nothing is kept.
        </p>

        <Group
          title="Scored assessments"
          note="A set of questions, weighted across the dimensions each one names."
          tools={liveToolsOfKind("assessment")}
        />

        <Group
          title="Calculators"
          note="Arithmetic on numbers you already have. The answer appears the moment you press it."
          tools={liveToolsOfKind("calculator")}
        />

        <Disclaimer />

        {/*
          The tools are not the product, and a page that ends on a disclaimer
          says nothing about what is. One line, and somewhere to go.
        */}
        <section
          className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-2xl p-6"
          style={{ backgroundColor: "#F4F8FC", border: "1px solid #DDE7F1" }}
        >
          <p className="text-[16px] leading-[1.7]" style={{ color: "#33404F" }}>
            Minimum Stress is a marketplace for private wellness space.
          </p>
          <div className="flex flex-wrap gap-5 text-[15px] font-medium">
            <Link href="/spaces" style={{ color: "#0A6390" }}>
              Find a space →
            </Link>
            <Link href="/rent-out-your" style={{ color: "#0A6390" }}>
              List your space →
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}

/* ------------------------------------------------------------------ */

function Group({ title, note, tools }: { title: string; note: string; tools: Tool[] }) {
  // Nothing to head. An empty heading with white space under it reads as a
  // page that failed to load rather than one still being written.
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
      href={`/assessments/${tool.slug}`}
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

      <p className="mt-2 flex-1 text-[14.5px] leading-[1.7]" style={{ color: "#33404F" }}>
        {tool.blurb}
      </p>

      <span
        className="mt-4 border-t pt-3 text-[13.5px] leading-[1.6]"
        style={{ borderColor: "#DDE7F1", color: "#4A5765" }}
      >
        {tool.kind === "assessment"
          ? "You get a score, what it means, and where to start."
          : "You get the number, and what it does and does not tell you."}
      </span>

      <span className="mt-3 text-[14px] font-medium" style={{ color: "#0F2F55" }}>
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
