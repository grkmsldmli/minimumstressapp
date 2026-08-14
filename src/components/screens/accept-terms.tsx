"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";

import { Headline } from "@/components/brand";
import { PrimaryButton } from "@/components/primitives";
import { errorMessage } from "@/lib/error-message";
import { ACCEPTANCE_POINTS } from "@/lib/terms";

import { NavyScreen } from "./shared";

/**
 * The terms, shown once and taken once.
 *
 * Everything else on this subject was already written down — that a session
 * arranged off the app has no cover, no refund and nobody to call — and
 * nobody had ever agreed to it. A host acknowledged a sublease declaration
 * per listing; a practitioner accepted nothing at all.
 *
 * So this is not a formality bolted on at the end. It is the moment that
 * turns "it was in the terms" into something with a date on it.
 *
 * There is no decline button, and that is honest rather than coercive: these
 * are the terms of using the app, and somebody who does not want them does not
 * want the app. What there is instead is the text, before the button, in
 * sentences rather than in a scroll box nobody reads.
 */
export function AcceptTerms({
  onAccept,
  onReadFull,
}: {
  onAccept: () => Promise<unknown>;
  onReadFull: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setError(null);
    setSaving(true);
    try {
      await onAccept();
    } catch (cause) {
      setSaving(false);
      setError(errorMessage(cause, "That did not save. Try again."));
    }
  };

  return (
    <NavyScreen>
      <div className="flex-1 overflow-y-auto px-8 pt-12 pb-6 relative z-10">
        <ShieldCheck size={22} color="#8FC6F5" />
        <div className="mt-3">
          <Headline pre="Before you" accent="begin." size={27} light />
        </div>

        <div className="flex flex-col gap-4 mt-7">
          {ACCEPTANCE_POINTS.map((point) => (
            <div
              key={point.title}
              className="rounded-2xl p-4"
              style={{
                backgroundColor: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.14)",
              }}
            >
              <p className="font-body font-medium text-[14.5px] text-white">{point.title}</p>
              <p className="font-body font-normal text-[13.5px] leading-relaxed mt-1.5 text-white/70">
                {point.body}
              </p>
            </div>
          ))}
        </div>

        {error && (
          <p className="font-body font-normal text-[13.5px] mt-4 text-coral-soft">{error}</p>
        )}
      </div>

      <div className="relative z-10 px-8 pb-9 shrink-0">
        {/*
          The way to the full text sits with the button, not below the cards.
          It was at the end of a scrolling list while "I agree" stayed on
          screen throughout — so agreeing was easier to reach than reading,
          which is the wrong way round on the one screen whose whole purpose is
          that somebody saw this before they accepted it.
        */}
        <button
          type="button"
          onClick={onReadFull}
          className="font-body text-[13.5px] mb-4 press text-sky-soft"
        >
          Read the full terms and privacy policy →
        </button>

        <PrimaryButton onClick={() => void accept()} disabled={saving}>
          {saving ? "One moment…" : "I agree — continue"}
        </PrimaryButton>
      </div>
    </NavyScreen>
  );
}
