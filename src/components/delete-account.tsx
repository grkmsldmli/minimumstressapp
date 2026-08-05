"use client";

import { AlertTriangle, Trash2 } from "lucide-react";
import { useState } from "react";

/**
 * Deleting an account, behind a typed confirmation.
 *
 * More friction than anything else in the app, deliberately. This is the one
 * action that cannot be undone by us or by anybody, and a single tap on a red
 * button is something a thumb does by accident.
 *
 * What survives is said before the confirmation rather than after it. Somebody
 * who deletes expecting everything to vanish and then finds their bookings
 * still exist has been misled, even though the reason is good — a completed
 * booking is a financial record for two people, and removing it takes a host's
 * own income history with it.
 */
export function DeleteAccount({ onDelete }: { onDelete: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmed = typed.trim().toUpperCase() === "DELETE";

  const run = async () => {
    if (!confirmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message
          ? failure.message
          : "We couldn't delete the account. Please try again.",
      );
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-1.5 py-3 rounded-xl font-body text-[12px] press text-ink-faint"
      >
        <Trash2 size={13} /> Delete my account
      </button>
    );
  }

  return (
    <div
      className="rounded-2xl p-4"
      style={{ backgroundColor: "#FEF8F7", border: "1px solid #F6D5D0" }}
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={15} color="#C4503F" className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="font-body font-medium text-[13px] text-coral-deep">
            This cannot be undone
          </p>
          <p className="font-body font-light text-[11.5px] mt-1.5 leading-relaxed text-ink-soft">
            Your documents, photos, phone number and emergency contact are deleted. Your name comes
            off your reviews and your bookings.
          </p>
          <p className="font-body font-light text-[11.5px] mt-2 leading-relaxed text-ink-soft">
            Completed bookings themselves are kept as financial records — they belong to the other
            side too, and deleting them would take their income history with them.
          </p>
          <p className="font-body font-light text-[11.5px] mt-2 leading-relaxed text-ink-faint">
            If you have a session still to come, cancel it first.
          </p>
        </div>
      </div>

      <div
        className="flex items-center gap-2 mt-3.5 px-3.5 py-2.5 rounded-xl bg-white"
        style={{ border: "1px solid #DCE7F2" }}
      >
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Type DELETE to confirm"
          aria-label="Type DELETE to confirm"
          autoComplete="off"
          className="font-body text-[13px] outline-none w-full text-navy bg-transparent"
        />
      </div>

      {error && (
        <p className="font-body font-light text-[11.5px] mt-2.5 leading-relaxed text-coral-deep">
          {error}
        </p>
      )}

      <div className="flex gap-2 mt-3">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setTyped("");
            setError(null);
          }}
          className="flex-1 py-2.5 rounded-full font-body font-medium text-[12px] press bg-white"
          style={{ border: "1px solid #DCE7F2", color: "#16304E" }}
        >
          Keep my account
        </button>
        <button
          type="button"
          onClick={() => void run()}
          disabled={!confirmed || busy}
          className="flex-1 py-2.5 rounded-full font-body font-medium text-[12px] press"
          style={{
            backgroundColor: confirmed && !busy ? "#C4503F" : "#F0D8D4",
            color: "#fff",
          }}
        >
          {busy ? "Deleting…" : "Delete"}
        </button>
      </div>
    </div>
  );
}
