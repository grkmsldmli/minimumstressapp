"use client";

import { AlertTriangle, ArrowLeft, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { Ambient, Headline } from "@/components/brand";
import { PrimaryButton, Toggle } from "@/components/primitives";
import { StarPicker } from "@/components/stars";
import type { Rating, ReviewerRole } from "@/lib/reviews";

/**
 * How each side says what happened.
 *
 * The sub-questions are the ones the other party can act on. "It was fine" is
 * not a repair instruction; "the code didn't work" is — and it is the sort of
 * thing people leave out of a comment box because it feels like complaining.
 * Asking directly gets an answer that a star rating alone never would.
 *
 * Only the overall rating is required. Every other field is skippable, because
 * the alternative to a partial review is usually no review.
 */

export interface ReviewDraft {
  overall: Rating;
  comment: string;
  safetyConcern: boolean;
  practitioner?: {
    accessOnTime: boolean;
    cleanliness: Rating | null;
    accuracy: Rating | null;
    wouldBookAgain: boolean;
  };
  host?: {
    leftAsFound: Rating | null;
    respectedHouseRules: boolean;
    onTime: boolean;
    wouldHostAgain: boolean;
  };
}

export function ReviewScreen({
  subjectName,
  role,
  onBack,
  onSubmit,
}: {
  /** The room, or the person — whichever this side is reviewing. */
  subjectName: string;
  role: ReviewerRole;
  onBack: () => void;
  onSubmit: (draft: ReviewDraft) => Promise<void>;
}) {
  const [overall, setOverall] = useState<Rating | null>(null);
  const [comment, setComment] = useState("");
  const [safetyConcern, setSafetyConcern] = useState(false);

  // Practitioner answers.
  const [accessOnTime, setAccessOnTime] = useState(true);
  const [cleanliness, setCleanliness] = useState<Rating | null>(null);
  const [accuracy, setAccuracy] = useState<Rating | null>(null);
  const [wouldBookAgain, setWouldBookAgain] = useState(true);

  // Host answers.
  const [leftAsFound, setLeftAsFound] = useState<Rating | null>(null);
  const [respectedHouseRules, setRespectedHouseRules] = useState(true);
  const [onTime, setOnTime] = useState(true);
  const [wouldHostAgain, setWouldHostAgain] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (overall === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        overall,
        comment,
        safetyConcern,
        ...(role === "practitioner"
          ? { practitioner: { accessOnTime, cleanliness, accuracy, wouldBookAgain } }
          : { host: { leftAsFound, respectedHouseRules, onTime, wouldHostAgain } }),
      });
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message
          ? failure.message
          : "We couldn't save that. Please try again.",
      );
      setBusy(false);
    }
  };

  const subject = role === "practitioner" ? subjectName : subjectName || "your guest";

  return (
    <div className="h-full flex flex-col screen-in bg-white">
      <div
        className="px-6 pt-8 pb-6 relative rounded-b-[30px] overflow-hidden shrink-0"
        style={{ background: "radial-gradient(140% 120% at 15% 0%, #1E4066 0%, #16304E 85%)" }}
      >
        <Ambient />
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="w-9 h-9 rounded-full flex items-center justify-center press relative z-20"
          style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
        >
          <ArrowLeft size={16} color="#fff" />
        </button>
        <div className="mt-3 relative z-10">
          <Headline pre="How was" accent={`${subject}?`} size={22} light />
        </div>
        <p className="font-body font-normal text-[13.5px] text-white/55 mt-1 relative z-10">
          Only you and they will see this, and not until you have both written.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pt-6 pb-8">
        <Section label="Overall">
          <StarPicker value={overall} onChange={setOverall} label="Overall rating" />
        </Section>

        {role === "practitioner" ? (
          <>
            <YesNo
              question="Was the door code or key waiting, and did it work?"
              value={accessOnTime}
              onChange={setAccessOnTime}
              yes="Yes, no problem"
              no="No, I had trouble"
            />
            <Section label="Cleanliness">
              <StarPicker value={cleanliness} onChange={setCleanliness} label="Cleanliness" size={24} />
            </Section>
            <Section label="Did the room match the listing?">
              <StarPicker value={accuracy} onChange={setAccuracy} label="Accuracy" size={24} />
            </Section>
            <YesNo
              question="Would you book here again?"
              value={wouldBookAgain}
              onChange={setWouldBookAgain}
              yes="Yes"
              no="No"
            />
          </>
        ) : (
          <>
            <Section label="How was the room left?">
              <StarPicker
                value={leftAsFound}
                onChange={setLeftAsFound}
                label="Room condition"
                size={24}
              />
            </Section>
            <YesNo
              question="Did they follow your house rules?"
              value={respectedHouseRules}
              onChange={setRespectedHouseRules}
              yes="Yes"
              no="No"
            />
            <YesNo
              question="Did they start and finish on time?"
              value={onTime}
              onChange={setOnTime}
              yes="Yes"
              no="No"
            />
            <YesNo
              question="Would you host them again?"
              value={wouldHostAgain}
              onChange={setWouldHostAgain}
              yes="Yes"
              no="No"
            />
          </>
        )}

        <Section label="Anything else — optional">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder={
              role === "practitioner"
                ? "What would you tell another practitioner about this room?"
                : "Anything the next studio should know?"
            }
            aria-label="Your comments"
            className="w-full font-body font-normal text-[14.5px] leading-relaxed px-4 py-3 rounded-xl outline-none resize-none text-navy"
            style={{ border: "1px solid #DCE7F2" }}
          />
        </Section>

        {/*
          Separate from the stars, and worded so ticking it is not an accusation.
          A five-star session can still end with an unlocked fire door, and
          those are the reports most easily lost — people will not give a bad
          rating to someone they otherwise liked.
        */}
        <div
          className="mt-6 rounded-2xl p-4"
          style={{ backgroundColor: "#FEF8F7", border: "1px solid #F6D5D0" }}
        >
          <div className="flex items-start gap-2.5">
            <ShieldAlert size={15} color="#C4503F" className="mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-body font-medium text-[15px] text-coral-deep">
                Was there anything unsafe?
              </p>
              <p className="font-body font-normal text-[14px] mt-1 leading-relaxed text-ink-soft">
                A blocked exit, a lock that didn&apos;t hold, someone who shouldn&apos;t have been
                there. Tick this and a person reads it — whatever rating you gave.
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between mt-3">
            <span className="font-body text-[13.5px] text-navy">Flag a safety concern</span>
            <Toggle
              on={safetyConcern}
              onClick={() => setSafetyConcern((v) => !v)}
              label="Flag a safety concern"
            />
          </div>
        </div>

        {error && (
          <div
            className="flex items-start gap-2 mt-4 px-3.5 py-3 rounded-xl"
            style={{ backgroundColor: "#FEF2F0", border: "1px solid #F6D5D0" }}
          >
            <AlertTriangle size={13} color="#C4503F" className="mt-0.5 shrink-0" />
            <p className="font-body font-normal text-[14px] leading-relaxed text-coral-deep">
              {error}
            </p>
          </div>
        )}
      </div>

      <div className="px-6 pt-3 pb-6 shrink-0" style={{ borderTop: "1px solid #F0ECE0" }}>
        <PrimaryButton disabled={overall === null || busy} onClick={() => void submit()}>
          {busy ? "Sending…" : "Send review"}
        </PrimaryButton>
        <p className="font-body font-normal text-[13.5px] text-center mt-2.5 text-ink-faint">
          Sealed until you have both written, or for 14 days.
        </p>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <p className="font-body font-medium text-[13.5px] uppercase tracking-wide text-sky-text mb-2.5">
        {label}
      </p>
      {children}
    </div>
  );
}

/**
 * Two buttons rather than a toggle.
 *
 * A toggle has a default, and a default on a question like "did the code work"
 * is an answer nobody gave. Both options are drawn, so choosing is visible and
 * not choosing is too.
 */
function YesNo({
  question,
  value,
  onChange,
  yes,
  no,
}: {
  question: string;
  value: boolean;
  onChange: (value: boolean) => void;
  yes: string;
  no: string;
}) {
  return (
    <div className="mb-6">
      <p className="font-body text-[14px] text-navy mb-2.5">{question}</p>
      <div role="radiogroup" aria-label={question} className="flex gap-2">
        {[
          { on: true, label: yes },
          { on: false, label: no },
        ].map((option) => (
          <button
            key={String(option.on)}
            type="button"
            role="radio"
            aria-checked={value === option.on}
            onClick={() => onChange(option.on)}
            className="flex-1 py-2.5 rounded-full font-body text-[13.5px] press"
            style={
              value === option.on
                ? { backgroundColor: "#16304E", color: "#fff" }
                : { border: "1px solid #DCE7F2", color: "#5A7189" }
            }
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
