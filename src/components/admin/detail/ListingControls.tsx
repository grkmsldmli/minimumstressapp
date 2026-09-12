"use client";

import { useState } from "react";

import { AMBER, CORAL, GREEN, LINE, MUTED, PANEL2, SKY, TEXT } from "../kit";

type ListingAction =
  | "approve"
  | "send_to_review"
  | "hide"
  | "restore_live"
  | "archive"
  | "delete";

function Button({
  children,
  tone = "normal",
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  tone?: "normal" | "good" | "warn" | "danger";
  disabled?: boolean;
  onClick: () => void;
}) {
  const color = tone === "good" ? GREEN : tone === "warn" ? AMBER : tone === "danger" ? CORAL : SKY;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-lg px-3 py-2 font-body font-semibold text-[12px] disabled:opacity-40 press"
      style={{ color, backgroundColor: `${color}18`, border: `1px solid ${color}55` }}
    >
      {children}
    </button>
  );
}

export function ListingControls({
  id,
  status,
  onChanged,
}: {
  id: string;
  status: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<ListingAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (
    action: ListingAction,
    opts: { reason?: boolean; confirm?: string; success: string; destructive?: boolean },
  ) => {
    if (busy) return;

    if (opts.destructive) {
      const typed = window.prompt("Type DELETE to permanently delete this listing. Booking history prevents deletion.");
      if (typed !== "DELETE") return;
    } else if (opts.confirm && !window.confirm(opts.confirm)) {
      return;
    }

    let note = "";
    if (opts.reason) {
      const answer = window.prompt("Reason for this intervention (saved to Audit log):");
      if (answer === null) return;
      note = answer.trim();
      if (note.length < 3) {
        setMessage("Add a short reason so the intervention is auditable.");
        return;
      }
    }

    setBusy(action);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/spaces/${id}/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ action, note }),
      });
      const payload = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(payload?.error ?? `Request failed (${res.status})`);
      setMessage(opts.success);
      onChanged();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The action failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl p-3.5" style={{ backgroundColor: PANEL2, border: `1px solid ${LINE}` }}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="font-body font-semibold text-[13px]" style={{ color: TEXT }}>Listing lifecycle</p>
          <p className="font-body text-[11.5px] mt-1 max-w-[680px]" style={{ color: MUTED }}>
            Listing controls change discoverability only. Existing bookings stay intact. Booking money/status must go through the booking, refund or cancellation workflow — never a manual status edit.
          </p>
        </div>
        <span className="font-body text-[11px] uppercase tracking-[0.16em]" style={{ color: MUTED }}>
          current · {status}
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        {status === "pending" && (
          <Button
            tone="good"
            disabled={Boolean(busy)}
            onClick={() => void run("approve", { confirm: "Approve this listing and make it live?", success: "Listing is live." })}
          >
            {busy === "approve" ? "Approving…" : "Approve & go live"}
          </Button>
        )}

        {(status === "delisted" || status === "archived") && (
          <Button
            tone="good"
            disabled={Boolean(busy)}
            onClick={() => void run("restore_live", { confirm: "Restore this verified listing to search now?", success: "Listing restored live." })}
          >
            {busy === "restore_live" ? "Restoring…" : "Restore live"}
          </Button>
        )}

        {status !== "pending" && (
          <Button
            tone="warn"
            disabled={Boolean(busy)}
            onClick={() => void run("send_to_review", { reason: true, success: "Listing moved to review." })}
          >
            {busy === "send_to_review" ? "Moving…" : "Send to review"}
          </Button>
        )}

        {(status === "active" || status === "pending") && (
          <Button
            tone="warn"
            disabled={Boolean(busy)}
            onClick={() => void run("hide", { reason: true, success: "Listing hidden from new bookings." })}
          >
            {busy === "hide" ? "Hiding…" : "Hide listing"}
          </Button>
        )}

        {status !== "archived" && (
          <Button
            disabled={Boolean(busy)}
            onClick={() => void run("archive", { reason: true, success: "Listing archived." })}
          >
            {busy === "archive" ? "Archiving…" : "Archive"}
          </Button>
        )}

        <Button
          tone="danger"
          disabled={Boolean(busy)}
          onClick={() => void run("delete", { reason: true, destructive: true, success: "Listing deleted." })}
        >
          {busy === "delete" ? "Deleting…" : "Delete permanently"}
        </Button>
      </div>

      {message && (
        <p className="font-body text-[12px] mt-3" style={{ color: message.toLowerCase().includes("failed") || message.toLowerCase().includes("cannot") || message.toLowerCase().includes("not ") ? CORAL : SKY }}>
          {message}
        </p>
      )}
    </div>
  );
}
