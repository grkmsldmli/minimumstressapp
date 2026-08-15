"use client";

import { useState } from "react";
import { ArrowLeft, ShieldAlert } from "lucide-react";

import { Ambient, Headline } from "@/components/brand";
import { PrimaryButton } from "@/components/primitives";
import type { Booking } from "@/lib/domain";
import { formatCents } from "@/lib/money";
import { REFUND_QUESTIONS, REFUND_WINDOW_DAYS, type RefundReason, questionFor } from "@/lib/refunds";
import { sessionDayLong } from "@/lib/when";

/**
 * Asking for money back.
 *
 * A list rather than a blank box, and the list is the point. A paragraph
 * cannot be counted, so it cannot be compared, so a pattern across somebody's
 * requests never becomes visible — and the reasons that need a photograph or
 * the studio's account of events cannot be told apart from the ones that do
 * not. The paragraph is still asked for, underneath, because the category is
 * what routes it and the words are what decide it.
 *
 * Written so an honest person is not made to feel accused of something. Most
 * people asking for a refund are not working an angle; they are annoyed and
 * out of pocket, and a form that opens by defending itself against fraud reads
 * as an accusation to the ninety who are telling the truth.
 */
export function RefundRequest({
  booking,
  onBack,
  onSubmit,
}: {
  booking: Booking;
  onBack: () => void;
  onSubmit: (input: {
    reason: RefundReason;
    detail: string;
  }) => Promise<{ state: string; because: string } | void>;
}) {
  const [reason, setReason] = useState<RefundReason | null>(null);
  const [detail, setDetail] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ state: string; because: string } | null>(null);

  const question = reason ? questionFor(reason) : null;
  const canSend = reason !== null && detail.trim().length >= 15 && !sending;

  const send = async () => {
    if (!canSend || !reason) return;
    setError(null);
    setSending(true);
    try {
      const result = await onSubmit({ reason, detail: detail.trim() });
      setAnswer(result ?? { state: "awaiting_staff", because: "We have it." });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That did not send.");
    } finally {
      setSending(false);
    }
  };

  if (answer) {
    const decided = answer.state === "approved" || answer.state === "refused";

    return (
      <div className="h-full flex flex-col bg-white screen-in">
        <Header onBack={onBack} title="Sent" />
        <div className="flex-1 overflow-y-auto px-6 pt-8">
          <p className="font-display italic font-semibold text-[20px] text-navy">
            {answer.state === "approved"
              ? "Refunded"
              : answer.state === "refused"
                ? "We cannot refund this one"
                : answer.state === "awaiting_host"
                  ? "We have asked the studio"
                  : "A person will read this"}
          </p>
          <p className="font-body font-normal text-[14.5px] mt-2 leading-relaxed text-ink-soft">
            {answer.because}
          </p>
          {!decided && (
            <p className="font-body font-normal text-[14px] mt-3 leading-relaxed text-ink-faint">
              We will email you either way. Nothing has been decided yet.
            </p>
          )}
        </div>
        <div className="px-6 pt-3 pb-6 shrink-0">
          <PrimaryButton onClick={onBack}>Done</PrimaryButton>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white screen-in">
      <Header onBack={onBack} title="Ask for a refund" />

      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-8">
        <p className="font-body font-medium text-[15px] text-navy">
          {booking.spaceName} · {sessionDayLong(booking.startsAt, booking.timeZone)}
        </p>
        <p className="font-body font-normal text-[13.5px] mt-0.5 text-ink-faint">
          You paid {formatCents(booking.totalCents)}. You can ask within {REFUND_WINDOW_DAYS} days
          of a session.
        </p>

        <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] mt-6 mb-2.5 text-sky-text">
          What went wrong?
        </p>

        <div className="flex flex-col gap-2">
          {REFUND_QUESTIONS.map((option) => {
            const on = reason === option.reason;
            return (
              <button
                key={option.reason}
                type="button"
                onClick={() => setReason(option.reason)}
                className="text-left px-4 py-3 rounded-xl font-body text-[14.5px] press"
                style={{
                  backgroundColor: on ? "#16304E" : "#fff",
                  color: on ? "#fff" : "#16304E",
                  border: `1px solid ${on ? "#16304E" : "#DCE7F2"}`,
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        {question && (
          <>
            <p className="font-body font-medium text-[14.5px] mt-6 text-navy">{question.prompt}</p>
            <textarea
              value={detail}
              onChange={(event) => setDetail(event.target.value.slice(0, 2000))}
              rows={5}
              className="font-body text-[15px] outline-none w-full rounded-xl px-3.5 py-3 mt-2 resize-none text-navy"
              style={{ border: "1px solid #DCE7F2" }}
            />
            <p className="font-body font-normal text-[13px] mt-1.5 text-ink-faint">
              {detail.trim().length < 15
                ? `${detail.trim().length} of 15 characters`
                : `${detail.length}/2000`}
            </p>

            {/*
              Said plainly, and only once the reason is chosen. Somebody who is
              about to accuse a host of something should know a person will
              read both accounts before anything moves — it is fairer to the
              host, and it stops the request that was written in anger from
              being written at all.
            */}
            {question.accusesHost && (
              <p className="font-body font-normal text-[13.5px] mt-3 leading-relaxed text-ink-soft">
                We will ask the studio what happened before deciding. Both accounts are read by a
                person.
              </p>
            )}

            {question.wantsPhoto && (
              <p className="font-body font-normal text-[13.5px] mt-2 leading-relaxed text-ink-soft">
                If you took a photo, mention it here and we will ask you for it — it usually settles
                this in one step.
              </p>
            )}

            {question.reason === "unsafe" && (
              <div
                className="flex items-start gap-2.5 mt-3 p-3.5 rounded-xl"
                style={{ backgroundColor: "#FEF2F0", border: "1px solid #F7D9D4" }}
              >
                <ShieldAlert size={15} color="#C4543F" className="mt-0.5 shrink-0" />
                <p className="font-body font-normal text-[13.5px] leading-relaxed text-navy">
                  This goes straight to a person, not a queue. If you are in danger right now, call
                  emergency services first.
                </p>
              </div>
            )}
          </>
        )}

        {error && (
          <p className="font-body font-normal text-[13.5px] mt-4 text-coral">{error}</p>
        )}
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
    <div
      /*
       * The gradient this header always needed.
       *
       * The block carried a `light` headline and a white-on-white back button
       * over no background at all, so on this screen "Sorted"/the title was
       * white text on white and only the blue accent word could be read. The
       * arrow was a ghost. Three screens shared the fault and all three are in
       * the money flow, which is the worst place to lose a way back.
       */
      className="px-6 pt-8 pb-6 relative rounded-b-[30px] overflow-hidden shrink-0"
      style={{ background: "radial-gradient(140% 120% at 15% 0%, #1E4066 0%, #16304E 85%)" }}
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
        <Headline pre="" accent={title} size={22} light />
      </div>
    </div>
  );
}
