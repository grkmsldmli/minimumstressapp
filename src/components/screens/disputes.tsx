"use client";

import { useState } from "react";
import { ArrowLeft, Scale } from "lucide-react";

import { Ambient, Headline } from "@/components/brand";
import { PrimaryButton } from "@/components/primitives";
import type { OpenDispute } from "@/lib/domain";
import { formatCents } from "@/lib/money";
import { sessionDayLong } from "@/lib/when";

/**
 * Everything either side has said about a session that is still unsettled.
 *
 * One screen for both directions. A practitioner asking for their money back
 * and a studio asking to be paid for a mess are the same conversation pointed
 * opposite ways, and somebody opening this wants to know what is waiting on
 * them rather than which table it lives in.
 *
 * The ones waiting on you come first, and they are the only ones with a box to
 * type in. Everything else is here to be read: what was said, what it would
 * cost, and how it ended.
 */
export function Disputes({
  disputes,
  onBack,
  onReply,
}: {
  disputes: OpenDispute[];
  onBack: () => void;
  onReply: (dispute: OpenDispute, reply: string) => Promise<void>;
}) {
  const waiting = disputes.filter((d) => d.awaitingYou);
  const rest = disputes.filter((d) => !d.awaitingYou);

  return (
    <div className="h-full flex flex-col bg-white screen-in">
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
          <Headline pre="Sorted" accent="out." size={22} light />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-8">
        {disputes.length === 0 ? (
          <div className="flex flex-col items-center text-center pt-10">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
              style={{ backgroundColor: "#EDF6FE" }}
            >
              <Scale size={22} color="#3B9BE8" />
            </div>
            <p className="font-display italic font-semibold text-[19px] text-navy">
              Nothing to sort out
            </p>
            <p className="font-body font-normal text-[14px] mt-2 leading-relaxed text-ink-faint">
              If a session goes wrong — either way round — it shows up here and neither side is
              charged until a person has read both accounts.
            </p>
          </div>
        ) : (
          <>
            {waiting.length > 0 && (
              <>
                <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] mb-2.5 text-sky-text">
                  Waiting on you
                </p>
                <div className="flex flex-col gap-3 mb-7">
                  {waiting.map((dispute) => (
                    <Card key={dispute.id} dispute={dispute} onReply={onReply} />
                  ))}
                </div>
              </>
            )}

            {rest.length > 0 && (
              <>
                <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] mb-2.5 text-sky-text">
                  Everything else
                </p>
                <div className="flex flex-col gap-3">
                  {rest.map((dispute) => (
                    <Card key={dispute.id} dispute={dispute} onReply={onReply} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const OUTCOME_WORDS: Record<string, string> = {
  full: "Refunded in full",
  our_fee: "Our fee refunded, the studio kept their rate",
  none: "Not refunded",
  upheld: "Charged",
  rejected: "Not charged",
  // The distinction a host needs: we agreed with them and still could not
  // collect. One of those is arguable and the other is not.
  uncollectable: "Agreed, but the card would not pay",
};

function Card({
  dispute,
  onReply,
}: {
  dispute: OpenDispute;
  onReply: (dispute: OpenDispute, reply: string) => Promise<void>;
}) {
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (reply.trim().length < 15 || sending) return;
    setError(null);
    setSending(true);
    try {
      await onReply(dispute, reply.trim());
      setSent(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That did not send.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="rounded-2xl p-4"
      style={{
        backgroundColor: dispute.awaitingYou ? "#FFF8F1" : "#F8FAFD",
        border: `1px solid ${dispute.awaitingYou ? "#F5DFC4" : "#E7EEF6"}`,
      }}
    >
      <p className="font-body font-medium text-[14.5px] text-navy">
        {dispute.reason}
        {dispute.amountCents !== null && ` · ${formatCents(dispute.amountCents)}`}
      </p>
      <p className="font-body font-normal text-[13px] mt-0.5 text-ink-faint">
        {dispute.spaceName} · {sessionDayLong(dispute.sessionStart, dispute.timeZone)}
      </p>

      <p className="font-body font-normal text-[14px] leading-relaxed mt-2.5 text-ink-muted">
        &ldquo;{dispute.detail}&rdquo;
      </p>

      {dispute.outcome && (
        <p className="font-body font-medium text-[13.5px] mt-2.5 text-navy">
          {OUTCOME_WORDS[dispute.outcome] ?? dispute.outcome}
        </p>
      )}

      {dispute.awaitingYou && !sent && (
        <>
          <p className="font-body font-medium text-[14px] mt-3.5 text-navy">
            What happened from your side?
          </p>
          <textarea
            value={reply}
            onChange={(event) => setReply(event.target.value.slice(0, 2000))}
            rows={4}
            className="font-body text-[15px] outline-none w-full rounded-xl px-3.5 py-3 mt-2 resize-none bg-white text-navy"
            style={{ border: "1px solid #DCE7F2" }}
          />
          {/*
            Said here rather than after sending. Answering is evidence, not a
            verdict — somebody with money at stake in the outcome cannot be the
            one who decides it, in either direction.
          */}
          <p className="font-body font-normal text-[13px] mt-1.5 leading-relaxed text-ink-faint">
            {reply.trim().length < 15
              ? `${reply.trim().length} of 15 characters`
              : "A person reads both accounts before anything moves."}
          </p>

          {error && <p className="font-body font-normal text-[13px] mt-2 text-coral">{error}</p>}

          <div className="mt-3">
            <PrimaryButton onClick={() => void send()} disabled={reply.trim().length < 15 || sending}>
              {sending ? "Sending…" : "Send my side"}
            </PrimaryButton>
          </div>
        </>
      )}

      {sent && (
        <p className="font-body font-medium text-[13.5px] mt-3 text-navy">
          Sent. We will email you when it is decided.
        </p>
      )}
    </div>
  );
}
