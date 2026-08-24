"use client";

import { useState } from "react";
import { ArrowLeftRight } from "lucide-react";

import type { AccountType } from "@/lib/domain";

/**
 * Asking to move to the other side of the marketplace.
 *
 * The route for this has existed since accounts were split in two and nothing
 * in the app ever called it. Staff had a queue to approve requests that nobody
 * could make: somebody who picked the wrong side at sign-up was stuck with it
 * for good, because the column is deliberately write-once and the only way out
 * was a route with no door.
 *
 * Deliberately plain and deliberately near the bottom of a profile. This is
 * rare and consequential — becoming a host means a lease, a legal
 * acknowledgement and payout setup — so it should be findable rather than
 * inviting.
 */
export function AccountChange({
  accountType,
  onRequest,
}: {
  accountType: AccountType;
  onRequest: (reason: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const other = accountType === "host" ? "practitioner" : "host";

  const send = async () => {
    if (sending) return;
    setError(null);
    setSending(true);
    try {
      await onRequest(reason.trim());
      setSent(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That did not send.");
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <p className="font-body font-normal text-[13.5px] leading-relaxed mt-2 text-ink-soft">
        Thanks — we&apos;ve got your request and will email you either way.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 w-full py-3 font-body text-[14px] press"
        style={{ color: "#8CA3BD" }}
      >
        <ArrowLeftRight size={13} />
        Need a different account type?
      </button>
    );
  }

  return (
    <div className="rounded-2xl p-4 mt-2" style={{ backgroundColor: "#F8FAFD", border: "1px solid #E7EEF6" }}>
      <p className="font-body font-medium text-[14.5px] text-navy">
        Move to a {other} account
      </p>
      {/*
        Said before they write anything. This is not a toggle: the two sides
        carry different obligations, and switching without meeting them would
        hand an account duties it never satisfied — which is what locking the
        column was for in the first place. The obligations are named plainly
        below rather than in the platform's own terms ("sublease", "payout
        account"); the person reading this is deciding whether to ask, not
        filling in a form yet.
      */}
      <p className="font-body font-normal text-[13.5px] leading-relaxed mt-1 text-ink-soft">
        {other === "host"
          ? "Want to list a space? Send us a request and we'll help set up your host account."
          : "We'll move you across once there's nothing outstanding on your listings."}
      </p>
      {other === "host" && (
        <p className="font-body font-normal text-[13px] leading-relaxed mt-2 text-ink-faint">
          You&apos;ll complete the required hosting details before your first listing goes live.
        </p>
      )}

      <textarea
        value={reason}
        onChange={(event) => setReason(event.target.value.slice(0, 1000))}
        rows={3}
        placeholder="Tell us anything we should know — optional"
        className="font-body text-[14.5px] outline-none w-full rounded-xl px-3.5 py-3 mt-3 resize-none bg-white text-navy"
        style={{ border: "1px solid #DCE7F2" }}
      />

      {error && <p className="font-body font-normal text-[13px] mt-2 text-coral">{error}</p>}

      <div className="flex gap-2 mt-3">
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending}
          className="flex-1 py-2.5 rounded-xl font-body font-medium text-[14.5px] text-white press"
          style={{ backgroundColor: "#16304E", opacity: sending ? 0.6 : 1 }}
        >
          {sending ? "Sending…" : other === "host" ? "Request host access" : "Ask to switch"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="px-4 py-2.5 rounded-xl font-body text-[14.5px] press bg-white"
          style={{ border: "1px solid #DCE7F2", color: "#16304E" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
