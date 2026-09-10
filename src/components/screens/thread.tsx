"use client";

import { ArrowLeft, Ban, Flag, Info, Send, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Ambient, Headline } from "@/components/brand";

/**
 * The conversation about one booking.
 *
 * Neither side sees the other's phone number or email — not because they are
 * hidden on this screen, but because the app never had them to show. What each
 * person gets is a first name and a thread, which is enough to sort out a door
 * that will not open and not enough to arrange the next session privately.
 *
 * Said out loud on the screen, once, at the top. A masking rule discovered
 * only when it fires reads as censorship; the same rule explained first reads
 * as the reason the refund guarantee works.
 */

export interface ThreadMessage {
  id: string;
  senderId: string;
  body: string;
  createdAt: Date;
  redactedKinds: string[];
}

export function Thread({
  messages,
  meId,
  otherName,
  spaceName,
  when,
  canSend,
  disabledReason,
  onBack,
  onSend,
  onReport,
  onBlock,
}: {
  messages: ThreadMessage[];
  meId: string;
  otherName: string;
  spaceName: string;
  when: string;
  /** Whether this booking can still receive new messages (server-enforced too). */
  canSend: boolean;
  /** Why the composer is disabled, shown in its place. Null when it is enabled. */
  disabledReason: string | null;
  onBack: () => void;
  onSend: (body: string) => Promise<{ notice: string | null }>;
  /** Report the other party to staff (App Store Guideline 1.2). */
  onReport: (reason: string) => Promise<void>;
  /** Block the other party — neither can message the other after this. */
  onBlock: () => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The safety sheet: report or block the other party. Kept out of the way until
  // the shield button is tapped, so it never competes with the conversation.
  const [safety, setSafety] = useState<"closed" | "menu" | "report" | "block">("closed");
  const [reportReason, setReportReason] = useState("");
  const [safetyBusy, setSafetyBusy] = useState(false);
  const [safetyDone, setSafetyDone] = useState<string | null>(null);

  const endRef = useRef<HTMLDivElement>(null);

  const runSafety = async (work: () => Promise<void>, done: string) => {
    if (safetyBusy) return;
    setSafetyBusy(true);
    setError(null);
    try {
      await work();
      setSafety("closed");
      setSafetyDone(done);
    } catch (failure) {
      // Never surface a raw provider/database error to the person reporting abuse.
      setError(failure instanceof Error && failure.message ? failure.message : "That didn't go through. Try again.");
    } finally {
      setSafetyBusy(false);
    }
  };

  // New messages appear at the bottom, which is only useful if you are looking
  // at the bottom.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending || !canSend) return;

    setSending(true);
    setError(null);
    try {
      const result = await onSend(text);
      setDraft("");
      setNotice(result.notice);
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message
          ? failure.message
          : "That didn't send. Try again.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="h-full flex flex-col screen-in bg-white">
      <div
        className="px-6 pt-8 pb-5 relative rounded-b-[30px] overflow-hidden shrink-0"
        style={{ background: "radial-gradient(140% 120% at 15% 0%, #1E4066 0%, #16304E 85%)" }}
      >
        <Ambient />
        <div className="flex items-center justify-between relative z-20">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="w-9 h-9 rounded-full flex items-center justify-center press"
            style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
          >
            <ArrowLeft size={16} color="#fff" />
          </button>
          <button
            type="button"
            onClick={() => {
              setSafetyDone(null);
              setSafety("menu");
            }}
            aria-label="Report or block"
            className="w-9 h-9 rounded-full flex items-center justify-center press"
            style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
          >
            <Flag size={15} color="#fff" />
          </button>
        </div>
        <div className="mt-3 relative z-10">
          <Headline pre="Message" accent={otherName} size={22} light />
        </div>
        <p className="font-body font-normal text-[13.5px] text-white/55 mt-1 relative z-10">
          {spaceName} · {when}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-4">
        {/*
          Stated before it can be discovered. Somebody who learns the rule by
          having a number vanish reads it as censorship; the same sentence up
          front reads as the reason the guarantee holds.
        */}
        <div
          className="flex items-start gap-2.5 p-3.5 rounded-2xl mb-4"
          style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
        >
          <ShieldCheck size={14} color="#3B9BE8" className="mt-0.5 shrink-0" />
          <div>
            <p className="font-body font-normal text-[14px] leading-relaxed text-ink-soft">
              Messages stay here, and so does everything else about this booking — the address, the
              door code, and the refund if it goes wrong. Neither of you sees the other&apos;s phone
              number or email.
            </p>
            {/*
              The consequence, not only the rule.
              "Don't share your number" on its own reads as a house style. What
              somebody needs before they type it is what stops applying the
              moment they do — and that it stops applying to them, not to us.
            */}
            <p className="font-body font-normal text-[14px] leading-relaxed mt-2 text-ink-faint">
              Please don&apos;t swap contact details or arrange anything off the app. A session
              booked elsewhere is between the two of you — no cover, no refund, and nobody to call.
            </p>
          </div>
        </div>

        {messages.length === 0 ? (
          <p className="font-body font-normal text-[14px] text-ink-faint text-center mt-8">
            No messages yet. Ask about parking, the door, or anything you need before you arrive.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {messages.map((message) => (
              <Bubble key={message.id} message={message} mine={message.senderId === meId} />
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {notice && (
        <div
          className="mx-6 mb-2 flex items-start gap-2 px-3.5 py-3 rounded-xl"
          style={{ backgroundColor: "#FEF8F7", border: "1px solid #F6D5D0" }}
        >
          <Info size={13} color="#C4503F" className="mt-0.5 shrink-0" />
          <p className="font-body font-normal text-[14px] leading-relaxed text-coral-deep">
            {notice}
          </p>
        </div>
      )}

      {safetyDone && (
        <div
          className="mx-6 mb-2 flex items-start gap-2 px-3.5 py-3 rounded-xl"
          style={{ backgroundColor: "#F0FAF6", border: "1px solid #CFEADD" }}
          role="status"
        >
          <ShieldCheck size={13} color="#1A8A5A" className="mt-0.5 shrink-0" />
          <p className="font-body font-normal text-[14px] leading-relaxed" style={{ color: "#1A5C3A" }}>
            {safetyDone}
          </p>
        </div>
      )}

      {error && (
        <p className="mx-6 mb-2 font-body font-normal text-[14px] text-coral-deep">{error}</p>
      )}

      {safety !== "closed" && (
        <SafetySheet
          otherName={otherName}
          mode={safety}
          busy={safetyBusy}
          reason={reportReason}
          setReason={setReportReason}
          onMenu={() => setSafety("menu")}
          onChoose={setSafety}
          onClose={() => setSafety("closed")}
          onReport={() =>
            runSafety(
              () => onReport(reportReason.trim() || "Reported from booking chat"),
              "Reported. Our team will review this conversation.",
            )
          }
          onBlock={() =>
            runSafety(onBlock, `You blocked ${otherName}. Neither of you can message the other now.`)
          }
        />
      )}

      {!canSend ? (
        <div className="px-6 pt-3 pb-6 shrink-0" style={{ borderTop: "1px solid #F0ECE0" }}>
          <p className="font-body font-normal text-[14px] leading-relaxed text-ink-faint text-center">
            {disabledReason ?? "This booking can no longer receive messages."}
          </p>
        </div>
      ) : (
      <div className="px-6 pt-3 pb-6 shrink-0" style={{ borderTop: "1px solid #F0ECE0" }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="flex gap-2 items-end"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, shift-enter breaks the line. A thread about a
              // locked door is short messages, fast.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            maxLength={2000}
            placeholder="Write a message"
            aria-label="Write a message"
            className="flex-1 font-body text-[14.5px] px-4 py-3 rounded-2xl outline-none resize-none text-navy"
            style={{ border: "1px solid #DCE7F2", maxHeight: 120 }}
          />
          <button
            type="submit"
            disabled={!draft.trim() || sending}
            aria-label="Send"
            className="w-11 h-11 rounded-full flex items-center justify-center press shrink-0"
            style={{
              backgroundColor: draft.trim() && !sending ? "#3B9BE8" : "#DCE7F2",
            }}
          >
            <Send size={16} color="#fff" />
          </button>
        </form>
      </div>
      )}
    </div>
  );
}

function Bubble({ message, mine }: { message: ThreadMessage; mine: boolean }) {
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[80%] px-3.5 py-2.5 rounded-2xl"
        style={
          mine
            ? { backgroundColor: "#16304E", borderBottomRightRadius: 6 }
            : { backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6", borderBottomLeftRadius: 6 }
        }
      >
        <p
          className="font-body font-normal text-[14.5px] leading-relaxed whitespace-pre-wrap"
          style={{ color: mine ? "#fff" : "#16304E" }}
        >
          {message.body}
        </p>
        <p
          className="font-body font-normal text-[12px] mt-1"
          style={{ color: mine ? "rgba(255,255,255,0.5)" : "#8CA3BD" }}
        >
          {message.createdAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
          {/*
            Shown on your own message only. The recipient does not need to know
            that something was removed — they never saw it — and telling them
            invites asking what it was.
          */}
          {mine && message.redactedKinds.length > 0 && " · contact details hidden"}
        </p>
      </div>
    </div>
  );
}

/**
 * Report or block the other party. A bottom sheet rather than a new screen: the
 * two safety actions the store requires, close to the conversation they are
 * about, and nowhere near the composer.
 */
function SafetySheet({
  otherName,
  mode,
  busy,
  reason,
  setReason,
  onMenu,
  onChoose,
  onClose,
  onReport,
  onBlock,
}: {
  otherName: string;
  mode: "menu" | "report" | "block";
  busy: boolean;
  reason: string;
  setReason: (value: string) => void;
  onMenu: () => void;
  onChoose: (mode: "report" | "block") => void;
  onClose: () => void;
  onReport: () => void;
  onBlock: () => void;
}) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0"
        style={{ backgroundColor: "rgba(10,26,44,0.35)" }}
      />
      <div className="relative bg-white rounded-t-[24px] px-6 pt-5 pb-8 screen-in">
        <div className="flex items-center justify-between mb-3">
          <p className="font-display italic font-semibold text-[18px] text-navy">
            {mode === "report" ? "Report conversation" : mode === "block" ? `Block ${otherName}` : "Safety"}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-full flex items-center justify-center press"
            style={{ backgroundColor: "#F1F3F6" }}
          >
            <X size={15} color="#16304E" />
          </button>
        </div>

        {mode === "menu" && (
          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              onClick={() => onChoose("report")}
              className="flex items-center gap-3 p-3.5 rounded-2xl press text-left"
              style={{ border: "1px solid #E7EEF6" }}
            >
              <Flag size={16} color="#C4503F" className="shrink-0" />
              <span>
                <span className="block font-body font-medium text-[15px] text-navy">Report conversation</span>
                <span className="block font-body font-normal text-[13.5px] text-ink-faint">
                  Send this thread to our team to review.
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => onChoose("block")}
              className="flex items-center gap-3 p-3.5 rounded-2xl press text-left"
              style={{ border: "1px solid #E7EEF6" }}
            >
              <Ban size={16} color="#C4503F" className="shrink-0" />
              <span>
                <span className="block font-body font-medium text-[15px] text-navy">Block {otherName}</span>
                <span className="block font-body font-normal text-[13.5px] text-ink-faint">
                  Stop messages between you. Your booking and its access details stay in place.
                </span>
              </span>
            </button>
            <a
              href="mailto:info@minimumstress.com"
              className="font-body font-normal text-[13.5px] text-center mt-1"
              style={{ color: "#0A6390" }}
            >
              Or contact support
            </a>
          </div>
        )}

        {mode === "report" && (
          <div>
            <p className="font-body font-normal text-[14px] leading-relaxed text-ink-soft">
              Tell us what happened. We review reports and act on our terms. Please don&rsquo;t include
              door codes or addresses — we already have the booking.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="What&rsquo;s the problem?"
              aria-label="What happened"
              className="mt-3 w-full font-body text-[14.5px] px-3.5 py-3 rounded-2xl outline-none resize-none text-navy"
              style={{ border: "1px solid #DCE7F2" }}
            />
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={onMenu}
                className="flex-1 py-3 rounded-full press font-body font-medium text-[15px]"
                style={{ border: "1px solid #DCE7F2", color: "#16304E" }}
              >
                Back
              </button>
              <button
                type="button"
                onClick={onReport}
                disabled={busy}
                className="flex-1 py-3 rounded-full press font-body font-medium text-[15px] text-white disabled:opacity-60"
                style={{ backgroundColor: "#C4503F" }}
              >
                {busy ? "Sending…" : "Send report"}
              </button>
            </div>
          </div>
        )}

        {mode === "block" && (
          <div>
            <p className="font-body font-normal text-[14px] leading-relaxed text-ink-soft">
              Block {otherName}? Neither of you will be able to message the other. This does not cancel
              the booking or hide its address or door code — those stay available to you as before.
            </p>
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={onMenu}
                className="flex-1 py-3 rounded-full press font-body font-medium text-[15px]"
                style={{ border: "1px solid #DCE7F2", color: "#16304E" }}
              >
                Back
              </button>
              <button
                type="button"
                onClick={onBlock}
                disabled={busy}
                className="flex-1 py-3 rounded-full press font-body font-medium text-[15px] text-white disabled:opacity-60"
                style={{ backgroundColor: "#C4503F" }}
              >
                {busy ? "Blocking…" : `Block ${otherName}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
