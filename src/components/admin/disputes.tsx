"use client";

import { useState } from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";

import type { StaffDispute } from "@/lib/admin/queue";
import { CLAIM_CAP_CENTS } from "@/lib/claims";
import { formatCents } from "@/lib/money";

/**
 * Deciding a refund request or a studio claim.
 *
 * Both accounts on one card, because the decision is a comparison and a screen
 * that shows one at a time invites deciding on whichever was read last. What
 * happened, what the other side said, what is at stake, and how often this
 * person has asked before — the last one is a count rather than a verdict, but
 * it is the fact a queue exists to surface.
 *
 * Every outcome needs a note, and it is quoted back to whoever is affected. A
 * refusal that explains itself is one somebody can argue with; an unexplained
 * one is a wall, and the person on the other side of it writes to their bank
 * instead — which costs more than the refund would have.
 */
const PANEL = "#152A40";
const BG = "#0E1D2E";
const LINE = "rgba(255,255,255,0.08)";
const MUTED = "#8CA3BD";

export function DisputeQueue({
  disputes,
  busy,
  onDecide,
}: {
  disputes: StaffDispute[];
  busy: string | null;
  onDecide: (dispute: StaffDispute, outcome: string, note: string, amountCents?: number) => void;
}) {
  if (disputes.length === 0) {
    return (
      <p className="font-body font-light text-[11.5px]" style={{ color: MUTED }}>
        Nothing here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {disputes.map((dispute) => (
        <Card key={dispute.id} dispute={dispute} busy={busy === dispute.id} onDecide={onDecide} />
      ))}
    </div>
  );
}

function Card({
  dispute,
  busy,
  onDecide,
}: {
  dispute: StaffDispute;
  busy: boolean;
  onDecide: (dispute: StaffDispute, outcome: string, note: string, amountCents?: number) => void;
}) {
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState(
    dispute.amountCents ? String((dispute.amountCents / 100).toFixed(2)) : "",
  );

  const ready = note.trim().length >= 15;
  const waitingOnUs = dispute.waitingOn === "us";

  const decide = (outcome: string) => {
    if (!ready || busy) return;
    onDecide(
      dispute,
      outcome,
      note.trim(),
      dispute.kind === "claim" && amount !== "" ? Math.round(Number(amount) * 100) : undefined,
    );
  };

  return (
    <div
      className="rounded-lg p-3.5"
      style={{
        backgroundColor: BG,
        border: `1px solid ${dispute.urgent ? "rgba(232,97,61,0.5)" : LINE}`,
      }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        {dispute.urgent && <AlertTriangle size={12} color="#E8613D" className="shrink-0" />}
        <span className="font-body font-medium text-[12.5px]" style={{ color: "#fff" }}>
          {dispute.reason}
        </span>
        <span
          className="px-2 py-0.5 rounded-full font-body text-[10px]"
          style={{
            backgroundColor: waitingOnUs ? "rgba(232,163,61,0.16)" : "rgba(255,255,255,0.06)",
            color: waitingOnUs ? "#E8A33D" : MUTED,
          }}
        >
          {waitingOnUs ? "on us" : "waiting on them"}
        </span>
        {dispute.amountCents !== null && (
          <span className="font-body text-[12px]" style={{ color: MUTED }}>
            {formatCents(dispute.amountCents)}
          </span>
        )}
      </div>

      <p className="font-body font-light text-[11px] mt-0.5" style={{ color: MUTED }}>
        {dispute.spaceName} ·{" "}
        {new Date(dispute.sessionStart).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })}
        {" · raised by the "}
        {dispute.raisedBy === "host" ? "studio" : "practitioner"}
      </p>

      {/*
        A count, not a verdict. Three genuinely bad sessions is possible, and
        refusing the fourth on arithmetic punishes somebody for their luck —
        but a person deciding should be able to see it.
      */}
      {dispute.recentFromSamePerson > 2 && (
        <p className="font-body text-[11px] mt-1" style={{ color: "#E8A33D" }}>
          {dispute.recentFromSamePerson} open requests from this account
        </p>
      )}

      <div className="mt-2.5 flex flex-col gap-2">
        <Account label={dispute.raisedBy === "host" ? "Studio" : "Practitioner"} text={dispute.detail} />
        {dispute.reply ? (
          <Account
            label={dispute.raisedBy === "host" ? "Practitioner" : "Studio"}
            text={dispute.reply}
          />
        ) : (
          <p className="font-body font-light text-[11px]" style={{ color: MUTED }}>
            The other side has not answered yet.
          </p>
        )}
      </div>

      {dispute.kind === "claim" && (
        <div className="flex items-center gap-2 mt-2.5">
          <span className="font-body text-[11.5px]" style={{ color: MUTED }}>
            Amount
          </span>
          <span className="font-body text-[11.5px]" style={{ color: "#fff" }}>
            $
          </span>
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, "").slice(0, 8))}
            inputMode="decimal"
            className="font-body text-[11.5px] outline-none rounded px-2 py-1"
            style={{ backgroundColor: PANEL, border: `1px solid ${LINE}`, color: "#fff", width: 90 }}
          />
          <span className="font-body font-light text-[10.5px]" style={{ color: MUTED }}>
            cleaning and overstay are recomputed server-side; cap {formatCents(CLAIM_CAP_CENTS)}
          </span>
        </div>
      )}

      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value.slice(0, 2000))}
        rows={2}
        placeholder="Why. Both sides are told, in these words."
        className="font-body text-[11.5px] outline-none w-full rounded px-2.5 py-2 mt-2.5 resize-none"
        style={{ backgroundColor: PANEL, border: `1px solid ${LINE}`, color: "#fff" }}
      />

      <div className="flex gap-2 mt-2">
        {dispute.kind === "refund" ? (
          <>
            <Action label="Refund all" tone="good" disabled={!ready || busy} onClick={() => decide("full")} />
            <Action
              label="Our fee only"
              tone="plain"
              disabled={!ready || busy}
              onClick={() => decide("our_fee")}
            />
            <Action label="Refuse" tone="bad" disabled={!ready || busy} onClick={() => decide("none")} />
          </>
        ) : (
          <>
            <Action
              label="Uphold and charge"
              tone="good"
              disabled={!ready || busy}
              onClick={() => decide("uphold")}
            />
            <Action
              label="Reject"
              tone="bad"
              disabled={!ready || busy}
              onClick={() => decide("reject")}
            />
          </>
        )}
      </div>

      {!ready && (
        <p className="font-body font-light text-[10.5px] mt-1.5" style={{ color: MUTED }}>
          A note is required — it is quoted back to them.
        </p>
      )}
    </div>
  );
}

function Account({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p
        className="font-body font-light text-[9.5px] uppercase tracking-[0.1em]"
        style={{ color: MUTED }}
      >
        {label}
      </p>
      <p className="font-body text-[11.5px] leading-relaxed" style={{ color: "#fff" }}>
        {text}
      </p>
    </div>
  );
}

function Action({
  label,
  tone,
  disabled,
  onClick,
}: {
  label: string;
  tone: "good" | "bad" | "plain";
  disabled: boolean;
  onClick: () => void;
}) {
  const colour =
    tone === "good" ? "#4E8C5B" : tone === "bad" ? "#C4543F" : "rgba(255,255,255,0.14)";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1 px-3 py-1.5 rounded font-body text-[11.5px] press"
      style={{ backgroundColor: colour, color: "#fff", opacity: disabled ? 0.4 : 1 }}
    >
      {label}
      <ArrowRight size={10} />
    </button>
  );
}
