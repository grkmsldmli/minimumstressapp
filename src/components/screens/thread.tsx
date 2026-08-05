"use client";

import { ArrowLeft, Info, Send, ShieldCheck } from "lucide-react";
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
  onBack,
  onSend,
}: {
  messages: ThreadMessage[];
  meId: string;
  otherName: string;
  spaceName: string;
  when: string;
  onBack: () => void;
  onSend: (body: string) => Promise<{ notice: string | null }>;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const endRef = useRef<HTMLDivElement>(null);

  // New messages appear at the bottom, which is only useful if you are looking
  // at the bottom.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;

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
          <Headline pre="Message" accent={otherName} size={22} light />
        </div>
        <p className="font-body font-light text-[11px] text-white/55 mt-1 relative z-10">
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
          <p className="font-body font-light text-[11.5px] leading-relaxed text-ink-soft">
            Messages stay here, and so does everything else about this booking — the address, the
            door code, and the refund if it goes wrong. Neither of you sees the other&apos;s phone
            number or email.
          </p>
        </div>

        {messages.length === 0 ? (
          <p className="font-body font-light text-[12.5px] text-ink-faint text-center mt-8">
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
          <p className="font-body font-light text-[11.5px] leading-relaxed text-coral-deep">
            {notice}
          </p>
        </div>
      )}

      {error && (
        <p className="mx-6 mb-2 font-body font-light text-[11.5px] text-coral-deep">{error}</p>
      )}

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
            className="flex-1 font-body text-[13px] px-4 py-3 rounded-2xl outline-none resize-none text-navy"
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
          className="font-body font-light text-[13px] leading-relaxed whitespace-pre-wrap"
          style={{ color: mine ? "#fff" : "#16304E" }}
        >
          {message.body}
        </p>
        <p
          className="font-body font-light text-[10px] mt-1"
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
