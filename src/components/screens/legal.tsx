"use client";

import { ArrowLeft, ChevronRight, ScrollText } from "lucide-react";

import { Ambient, Headline } from "@/components/brand";
import { LEGAL_TOPICS, SECTIONS } from "@/lib/legal-text";

/**
 * Terms and privacy, as four cards rather than a document.
 *
 * This screen used to render SECTIONS in full, every section expandable, with
 * the terms already open. It was accurate and it was the wrong thing to build:
 * somebody opening this to check a cancellation window got the entity name,
 * the independent-contractor position and a list of which company stores the
 * database. That last one is worth saying twice — an account screen is not
 * where anybody learns our infrastructure, and putting it there told everybody
 * who reads it more about how to attack us than it told them about privacy.
 *
 * So the detail did not shrink; it moved. /terms and /privacy publish SECTIONS
 * in full, they are what an acceptance is recorded against, and every card
 * here opens the one that covers it. What is left on the phone is a map: four
 * headings, what each is about, and a way through.
 *
 * The count under each card is read from SECTIONS rather than written down, so
 * a card can never claim to cover something that is no longer there.
 */

export function Legal({ onBack, onOpen }: { onBack: () => void; onOpen: (path: string) => void }) {
  return (
    <div className="h-full flex flex-col screen-in bg-white">
      <div
        className="px-6 pt-8 pb-6 relative rounded-b-[30px] overflow-hidden shrink-0"
        style={{ background: "radial-gradient(130% 130% at 20% 0%, #1E4066 0%, #16304E 80%)" }}
      >
        <Ambient />
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="w-9 h-9 rounded-full flex items-center justify-center press relative z-10"
          style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
        >
          <ArrowLeft size={16} color="#fff" />
        </button>
        <div className="mt-3 relative z-10">
          <Headline pre="Terms &" accent="privacy." size={24} light />
        </div>
        <p className="font-body font-normal text-[14px] text-white/65 mt-1 relative z-10">
          {/*
            No longer "the terms you accepted, in full" — that was true of the
            old screen and would be a lie about this one. What it says instead
            is what each card does, so nobody reads four summaries believing
            they have read the document.
          */}
          The short version. Every card opens the full text.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-8">
        <div className="flex flex-col gap-2.5">
          {LEGAL_TOPICS.map((topic) => {
            const covered = SECTIONS.filter((section) => topic.covers.includes(section.key));
            return (
              <button
                key={topic.key}
                type="button"
                onClick={() => onOpen(topic.scope === "terms" ? "/terms" : "/privacy")}
                className="w-full text-left rounded-2xl p-4 press bg-white"
                style={{ border: "1px solid #E7EEF6" }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="flex items-center gap-2.5 font-body font-medium text-[15px] text-navy">
                      <ScrollText size={15} color="#3B9BE8" />
                      {topic.title}
                    </span>
                    <p className="font-body font-normal text-[13.5px] leading-relaxed mt-1.5 text-ink-muted">
                      {topic.blurb}
                    </p>
                    <p className="font-body font-normal text-[13px] mt-2 text-sky-text">
                      Read the full{" "}
                      {topic.scope === "terms" ? "terms" : "privacy policy"} →
                    </p>
                  </div>
                  <ChevronRight size={16} color="#B9CBDD" className="mt-0.5 shrink-0" />
                </div>

                {/*
                  Which sections this stands for, named rather than counted.
                  A card that says only "Payment, cancellation, access and
                  refunds" is a summary somebody has to trust; the headings
                  underneath are how they check it covers the thing they came
                  here about before they tap.
                */}
                <p className="font-body font-normal text-[12.5px] leading-relaxed mt-2.5 text-ink-faint">
                  {covered.map((section) => section.title).join(" · ")}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
