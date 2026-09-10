"use client";

import { useEffect, useState } from "react";
import { CreditCard, Trash2 } from "lucide-react";

import { apiFetch } from "@/lib/api-fetch";
import { CLAIM_CAP_CENTS, CLEANING_FEE_CENTS, CLAIM_WINDOW_HOURS } from "@/lib/claims";
import { formatCents } from "@/lib/money";

/**
 * The card we keep, said out loud.
 *
 * The profile row used to read "Payment method — Entered at checkout", which
 * was true about where the card is typed and silent about what happens next:
 * it is kept, and it can be charged off-session for cleaning, overstay or
 * damage after a session. One sentence at checkout was the only place that had
 * ever been said, and there was no way to see the card again or take it back.
 *
 * So this shows the four digits, lists every amount that can reach them, and
 * offers to stop. A person who can see what a card is for and remove it does
 * not need to phone their bank to achieve the same thing — which is the outcome
 * this is really preventing, because a chargeback costs everybody more than the
 * cleaning fee did.
 */

interface Card {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

export function SavedCard({ isPro }: { isPro: boolean }) {
  const [card, setCard] = useState<Card | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Asked, never assumed.
   *
   * The first version set the card to null on a successful delete rather than
   * reading back, and reported "gone" while a second card was still attached.
   * Whether a card is on file is Stripe's answer to give.
   */
  const load = async (): Promise<Card | null> => {
    try {
      const response = await apiFetch("/api/account/card");
      const body = (await response.json().catch(() => ({}))) as { card?: Card | null };
      return body.card ?? null;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const loaded = await load();
      if (!cancelled) setCard(loaded);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch("/api/account/card", { method: "DELETE" });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "That did not work.");
      setCard(await load());
      setOpen(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  // Nothing yet, and nothing to explain. The card arrives with the first
  // booking, and a settings screen about a card that does not exist is noise.
  if (card === undefined || card === null) {
    return (
      <div
        className="w-full flex items-center gap-3 p-3.5 rounded-xl bg-white"
        style={{ border: "1px solid #E7EEF6" }}
      >
        <CreditCard size={15} color="#3B9BE8" />
        <span className="flex-1 font-body font-medium text-[14.5px] text-navy">Payment method</span>
        <span className="font-body font-normal text-[13.5px] text-ink-faint">
          {card === undefined ? "…" : "Added at your first booking"}
        </span>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-3 p-3.5 rounded-xl bg-white press"
        style={{ border: "1px solid #E7EEF6" }}
      >
        <CreditCard size={15} color="#3B9BE8" />
        <span className="flex-1 text-left font-body font-medium text-[14.5px] text-navy">
          Payment method
        </span>
        <span className="font-body font-normal text-[13.5px] text-ink-faint">
          {brandName(card.brand)} ···· {card.last4}
        </span>
      </button>
    );
  }

  return (
    <div className="rounded-2xl p-4 bg-white" style={{ border: "1px solid #E7EEF6" }}>
      <div className="flex items-center gap-2.5">
        <CreditCard size={15} color="#3B9BE8" />
        <span className="font-body font-medium text-[14.5px] text-navy">
          {brandName(card.brand)} ending {card.last4}
        </span>
        <span className="font-body font-normal text-[13px] text-ink-faint">
          expires {String(card.expMonth).padStart(2, "0")}/{String(card.expYear).slice(-2)}
        </span>
      </div>

      <p className="font-body font-normal text-[14px] leading-relaxed mt-3 text-ink-soft">
        Kept so booking again takes one tap. It is charged when you book, and after a session it can
        be charged again only for these:
      </p>

      {/*
        The amounts, not a link to the amounts. "See our terms for applicable
        fees" is how somebody finds out what they agreed to at the moment they
        are being charged it.
      */}
      <ul className="mt-2.5 flex flex-col gap-1.5">
        <Line
          amount={formatCents(CLEANING_FEE_CENTS)}
          what="extra cleaning, when a room is left needing more than the usual turnaround"
        />
        <Line
          amount="the room's own hourly rate"
          what="time over your hour, rounded up to the half hour"
        />
        <Line
          amount={`up to ${formatCents(CLAIM_CAP_CENTS)}`}
          what="damage, at what the repair actually cost"
        />
      </ul>

      <p className="font-body font-normal text-[14px] leading-relaxed mt-2.5 text-ink-soft">
        A studio has {CLAIM_WINDOW_HOURS} hours after a session to raise one. You are told and asked
        for your side first, and a person here decides — never the studio, and never automatically.
      </p>

      {/*
        Said before they tap, not after. Removing the card stops the Pro
        payment along with everything else, and finding that out from a failed
        renewal is finding it out too late.
      */}
      {isPro && (
        <p className="font-body font-normal text-[14px] leading-relaxed mt-2.5 text-ink-faint">
          Removing it also ends Pro at your next renewal — there would be nothing to charge the
          $9.90 to.
        </p>
      )}

      {error && <p className="font-body font-normal text-[13.5px] mt-2.5 text-coral">{error}</p>}

      <div className="flex gap-2 mt-3.5">
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-body text-[14px] press bg-white"
          style={{ border: "1px solid #F6D5D0", color: "#B45143", opacity: busy ? 0.6 : 1 }}
        >
          <Trash2 size={13} />
          {busy ? "Removing…" : "Remove my card"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="px-4 py-2.5 rounded-xl font-body text-[14px] press bg-white"
          style={{ border: "1px solid #DCE7F2", color: "#16304E" }}
        >
          Done
        </button>
      </div>
    </div>
  );
}

function Line({ amount, what }: { amount: string; what: string }) {
  return (
    <li className="flex gap-2">
      <span className="font-body font-medium text-[14px] text-navy shrink-0">{amount}</span>
      <span className="font-body font-normal text-[14px] leading-relaxed text-ink-soft">{what}</span>
    </li>
  );
}

/** Stripe's lowercase word, in the case a card is actually printed in. */
function brandName(brand: string): string {
  const known: Record<string, string> = {
    visa: "Visa",
    mastercard: "Mastercard",
    amex: "Amex",
    discover: "Discover",
    diners: "Diners Club",
    jcb: "JCB",
    unionpay: "UnionPay",
  };
  return known[brand] ?? brand.charAt(0).toUpperCase() + brand.slice(1);
}
