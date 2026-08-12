"use client";

import { useState } from "react";
import { ArrowLeft, ChevronDown, ScrollText } from "lucide-react";

import { Ambient, Headline } from "@/components/brand";
import { SECTIONS } from "@/lib/legal-text";

/**
 * The short, in-app version, read from the same array the published pages use.
 *
 * The wording moved to legal-text.ts when /terms and /privacy were published:
 * acceptance is recorded against this text with a version, so a second copy
 * here would drift and make every stored acceptance unverifiable.
 */

export function Legal({ onBack }: { onBack: () => void }) {
  const [open, setOpen] = useState<string | null>("terms");

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
          <Headline pre="The" accent="fine print." size={24} light />
        </div>
        <p className="font-body font-normal text-[14px] text-white/65 mt-1 relative z-10">
          {/*
            These are the terms, not a summary of terms kept elsewhere.
            Acceptance is recorded against this text, with a version and a
            timestamp — pointing at a different document as the binding one
            would make that record worthless.
          */}
          The terms you accepted, in full.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-8">
        <div className="flex flex-col gap-2.5">
          {SECTIONS.map((section) => {
            const isOpen = open === section.key;
            return (
              <div
                key={section.key}
                className="rounded-2xl overflow-hidden"
                style={{ border: "1px solid #E7EEF6" }}
              >
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : section.key)}
                  aria-expanded={isOpen}
                  className="w-full flex items-center justify-between p-4 press bg-white"
                >
                  <span className="flex items-center gap-2.5 font-body font-medium text-[15px] text-navy">
                    <ScrollText size={15} color="#3B9BE8" />
                    {section.title}
                  </span>
                  <ChevronDown
                    size={16}
                    color="#B9CBDD"
                    style={{
                      transform: isOpen ? "rotate(180deg)" : "none",
                      transition: "transform 0.2s",
                    }}
                  />
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 card-in">
                    <ul className="flex flex-col gap-2">
                      {section.points.map((point) => (
                        <li key={point} className="flex items-start gap-2">
                          <span
                            className="w-1 h-1 rounded-full mt-2 shrink-0"
                            style={{ backgroundColor: "#8CA3BD" }}
                          />
                          <p className="font-body font-normal text-[13.5px] leading-relaxed text-ink-muted">
                            {point}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
