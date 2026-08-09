"use client";

import { AlertTriangle, ArrowLeft, Check, Clock } from "lucide-react";

import { Headline } from "@/components/brand";
import { type NotificationEntry, describeNotification, explainState } from "@/lib/notify/history";

/**
 * What the app has sent you.
 *
 * It has been sending email since the first booking and keeping no record
 * anybody could read. Somebody who missed the message about a session starting
 * in an hour had nowhere in the product to look — not a stale inbox, not a
 * spam folder, nothing that could even tell them it had been sent.
 *
 * The row existed the whole time. Only staff could see it.
 *
 * Not the email bodies. The stored row keeps a kind and no text, deliberately:
 * the body is rendered from a booking that may since have changed, and
 * replaying it later would show a rate or a time that is no longer true. This
 * is a receipt for a message, and it says so by being short.
 */
export function Notifications({
  entries,
  onBack,
}: {
  entries: NotificationEntry[];
  onBack: () => void;
}) {
  const failed = entries.filter((e) => e.state === "failed").length;

  return (
    <div className="h-full flex flex-col screen-in bg-white">
      <div
        className="px-6 pt-8 pb-6 relative rounded-b-[30px] overflow-hidden shrink-0"
        style={{ background: "radial-gradient(130% 130% at 20% 0%, #1E4066 0%, #16304E 80%)" }}
      >
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
          <Headline pre="What we've" accent="sent you." size={24} light />
        </div>
        {failed > 0 && (
          /*
            Said at the top rather than left to be discovered by scrolling. A
            message that did not arrive is the only reason most people open
            this screen.
          */
          <p className="font-body font-normal text-[14px] mt-2 relative z-10 text-coral-soft">
            {failed === 1
              ? "One message could not be delivered."
              : `${failed} messages could not be delivered.`}
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-8">
        {entries.length === 0 ? (
          <p className="font-body font-normal text-[14px] leading-relaxed text-ink-soft">
            Nothing yet. Messages about your bookings appear here.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {entries.map((entry) => (
              <Row key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ entry }: { entry: NotificationEntry }) {
  const failed = entry.state === "failed";
  const at = entry.sentAt ?? entry.createdAt;

  const Icon = failed ? AlertTriangle : entry.state === "sent" ? Check : Clock;
  const tint = failed ? "#B45143" : entry.state === "sent" ? "#557255" : "#566D85";

  return (
    <div
      className="rounded-xl px-3.5 py-3 flex items-start gap-2.5"
      style={
        failed
          ? { backgroundColor: "#FEF2F0", border: "1px solid #F5C4BC" }
          : { backgroundColor: "#fff", border: "1px solid #E7EEF6" }
      }
    >
      <Icon size={14} color={tint} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="font-body font-medium text-[15px] text-navy">
          {describeNotification(entry.kind)}
        </p>
        <p className="font-body font-normal text-[13.5px] mt-0.5 text-ink-soft">
          {explainState(entry.state)} ·{" "}
          {at.toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
          {at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
        </p>
        {failed && (
          <p className="font-body font-normal text-[13.5px] mt-1 leading-relaxed text-ink-soft">
            {/*
              What to do about it, since the app cannot fix a mailbox. The
              detail of why is the operator's, not theirs — a provider's error
              string is written for us and reads as noise here.
            */}
            Check the address on your account, or get in touch and we will
            resend it.
          </p>
        )}
      </div>
    </div>
  );
}
