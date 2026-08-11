"use client";

import { useState } from "react";
import { AlertTriangle, ArrowLeft } from "lucide-react";

import { Ambient, Headline } from "@/components/brand";
import { PrimaryButton } from "@/components/primitives";
import {
  CLAIM_CAP_CENTS,
  CLAIM_TYPES,
  CLAIM_WINDOW_HOURS,
  type ClaimKind,
  claimType,
  overstayCents,
} from "@/lib/claims";
import { formatCents } from "@/lib/money";

/**
 * A studio reporting that a session left the room worse than it found it.
 *
 * Written so a host understands what they are starting. Nothing is charged
 * here: the practitioner is asked what happened and a person decides. Saying
 * that up front is not a disclaimer, it is the difference between a host who
 * expects money tomorrow and one who is not surprised on Thursday.
 *
 * The published amounts are shown before the button rather than after, because
 * a fixed price only works as a fixed price if both sides could see it in
 * advance. It is the whole reason cleaning has a number instead of an estimate.
 */
export function ClaimForm({
  spaceName,
  hourlyRateCents,
  onBack,
  onSubmit,
}: {
  spaceName: string;
  hourlyRateCents: number;
  onBack: () => void;
  onSubmit: (input: {
    kind: ClaimKind;
    detail: string;
    minutesOver: number | null;
    claimedCents: number | null;
  }) => Promise<{ state: string; amountCents: number | null; because: string } | void>;
}) {
  const [kind, setKind] = useState<ClaimKind | null>(null);
  const [detail, setDetail] = useState("");
  const [minutesOver, setMinutesOver] = useState("");
  const [claimed, setClaimed] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ because: string } | null>(null);

  const type = kind ? claimType(kind) : null;

  const overstayMinutes = Number(minutesOver);
  const likely =
    kind === "overstay" && overstayMinutes > 0
      ? overstayCents(overstayMinutes, hourlyRateCents)
      : type?.fixedCents ?? null;

  const canSend =
    kind !== null &&
    detail.trim().length >= 15 &&
    (kind !== "overstay" || overstayMinutes > 0) &&
    !sending;

  const send = async () => {
    if (!canSend || !kind) return;
    setError(null);
    setSending(true);
    try {
      const result = await onSubmit({
        kind,
        detail: detail.trim(),
        minutesOver: kind === "overstay" ? overstayMinutes : null,
        claimedCents: kind === "damage" && claimed !== "" ? Math.round(Number(claimed) * 100) : null,
      });
      setAnswer(result ?? { because: "We have it." });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That did not send.");
    } finally {
      setSending(false);
    }
  };

  if (answer) {
    return (
      <div className="h-full flex flex-col bg-white screen-in">
        <Header onBack={onBack} title="Sent" />
        <div className="flex-1 overflow-y-auto px-6 pt-8">
          <p className="font-display italic font-semibold text-[20px] text-navy">
            We have asked them
          </p>
          <p className="font-body font-normal text-[14.5px] mt-2 leading-relaxed text-ink-soft">
            {answer.because}
          </p>
          <p className="font-body font-normal text-[14px] mt-3 leading-relaxed text-ink-faint">
            Nothing has been charged. They get to say what happened, then a person decides and we
            email you either way.
          </p>
        </div>
        <div className="px-6 pt-3 pb-6 shrink-0">
          <PrimaryButton onClick={onBack}>Done</PrimaryButton>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white screen-in">
      <Header onBack={onBack} title="Report a problem" />

      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-8">
        <p className="font-body font-medium text-[15px] text-navy">{spaceName}</p>
        <p className="font-body font-normal text-[13.5px] mt-0.5 text-ink-faint">
          Within {CLAIM_WINDOW_HOURS} hours of a session. After that a room has been used by other
          people and it cannot fairly be pinned on one of them.
        </p>

        <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] mt-6 mb-2.5 text-sky-text">
          What happened?
        </p>

        <div className="flex flex-col gap-2">
          {CLAIM_TYPES.map((option) => {
            const on = kind === option.kind;
            return (
              <button
                key={option.kind}
                type="button"
                onClick={() => setKind(option.kind)}
                className="text-left px-4 py-3 rounded-xl font-body text-[14.5px] press"
                style={{
                  backgroundColor: on ? "#16304E" : "#fff",
                  color: on ? "#fff" : "#16304E",
                  border: `1px solid ${on ? "#16304E" : "#DCE7F2"}`,
                }}
              >
                {option.label}
                {option.fixedCents !== null && (
                  <span
                    className="block font-body font-normal text-[13px] mt-0.5"
                    style={{ color: on ? "rgba(255,255,255,0.62)" : "#8CA3BD" }}
                  >
                    {formatCents(option.fixedCents)} — the same for every studio
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {kind === "overstay" && (
          <>
            <p className="font-body font-medium text-[14.5px] mt-6 text-navy">
              How many minutes over?
            </p>
            <div className="flex items-center gap-2 mt-2">
              <input
                value={minutesOver}
                onChange={(event) => setMinutesOver(event.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                inputMode="numeric"
                placeholder="e.g. 25"
                className="font-body text-[15px] outline-none rounded-xl px-3.5 py-3 w-full text-navy"
                style={{ border: "1px solid #DCE7F2" }}
              />
              <span className="font-body font-normal text-[15px] shrink-0 text-ink-soft">min</span>
            </div>
            {likely !== null && likely > 0 && (
              <p className="font-body font-normal text-[13.5px] mt-1.5 text-ink-faint">
                {formatCents(likely)} at your own hourly rate, rounded up to the half hour.
              </p>
            )}
          </>
        )}

        {kind === "damage" && (
          <>
            <p className="font-body font-medium text-[14.5px] mt-6 text-navy">
              What will it cost to put right?
            </p>
            <div className="flex items-center gap-2 mt-2">
              <span className="font-body font-medium text-[15px] text-navy">$</span>
              <input
                value={claimed}
                onChange={(event) => setClaimed(event.target.value.replace(/[^\d.]/g, "").slice(0, 8))}
                inputMode="decimal"
                placeholder="0.00"
                className="font-body text-[15px] outline-none rounded-xl px-3.5 py-3 w-full text-navy"
                style={{ border: "1px solid #DCE7F2" }}
              />
            </div>
            <p className="font-body font-normal text-[13.5px] mt-1.5 leading-relaxed text-ink-faint">
              We settle up to {formatCents(CLAIM_CAP_CENTS)} between two accounts. Above that we
              keep the record and the photographs, and it is what your own insurance is for.
            </p>
          </>
        )}

        {type && (
          <>
            <p className="font-body font-medium text-[14.5px] mt-6 text-navy">{type.prompt}</p>
            <textarea
              value={detail}
              onChange={(event) => setDetail(event.target.value.slice(0, 2000))}
              rows={5}
              className="font-body text-[15px] outline-none w-full rounded-xl px-3.5 py-3 mt-2 resize-none text-navy"
              style={{ border: "1px solid #DCE7F2" }}
            />
            <p className="font-body font-normal text-[13px] mt-1.5 text-ink-faint">
              {detail.trim().length < 15 ? `${detail.trim().length} of 15 characters` : `${detail.length}/2000`}
            </p>

            {type.requiresPhoto && (
              <div
                className="flex items-start gap-2.5 mt-3 p-3.5 rounded-xl"
                style={{ backgroundColor: "#FFF8F1", border: "1px solid #F5DFC4" }}
              >
                <AlertTriangle size={15} color="#8B6C37" className="mt-0.5 shrink-0" />
                <p className="font-body font-normal text-[13.5px] leading-relaxed text-navy">
                  Take photographs now if you have not already. Nobody is charged on a description
                  alone, and we will ask you for them.
                </p>
              </div>
            )}

            {/*
              Said before the button, to a host who might be expecting an
              invoice. Most claims are honest; the ones that go wrong go wrong
              because somebody thought this was a charge rather than a request.
            */}
            <p className="font-body font-normal text-[13.5px] mt-3 leading-relaxed text-ink-soft">
              Nothing is charged when you send this. We ask the practitioner what happened, then a
              person decides.
            </p>
          </>
        )}

        {error && <p className="font-body font-normal text-[13.5px] mt-4 text-coral">{error}</p>}
      </div>

      <div className="px-6 pt-3 pb-6 shrink-0" style={{ borderTop: "1px solid #F0ECE0" }}>
        <PrimaryButton onClick={() => void send()} disabled={!canSend}>
          {sending ? "Sending…" : "Send"}
        </PrimaryButton>
      </div>
    </div>
  );
}

function Header({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <div className="px-6 pt-8 pb-6 relative rounded-b-[30px] overflow-hidden shrink-0">
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
        <Headline pre="" accent={title} size={22} light />
      </div>
    </div>
  );
}
