"use client";

import { Phone, ShieldCheck } from "lucide-react";
import { useState } from "react";

import type { EmergencyContact } from "@/lib/domain";

/**
 * Somebody to call if a session goes wrong while it is happening.
 *
 * Asked of both sides, for the same reason and with the same promise: a
 * practitioner alone in a stranger's building and a host letting a stranger
 * into theirs are in the same position, and neither should have to give up
 * privacy to be safe. The counterpart never sees this — not before a booking,
 * not during one, not after. Only staff can read it, through the same boundary
 * the verification documents sit behind.
 *
 * Optional, and it says so. A required field here would be answered with
 * whatever gets past validation, and a fake number is worse than none — it
 * looks like a plan.
 */
export function EmergencyContactCard({
  contact,
  onSave,
}: {
  contact: EmergencyContact;
  /** Resolves once it is stored. A rejection is shown, not swallowed. */
  onSave: (contact: EmergencyContact) => Promise<unknown> | void;
}) {
  const [name, setName] = useState(contact.name ?? "");
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [relationship, setRelationship] = useState(contact.relationship ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  const dirty =
    name !== (contact.name ?? "") ||
    phone !== (contact.phone ?? "") ||
    relationship !== (contact.relationship ?? "");

  /** Whether anything is actually on file, rather than whether a button was pressed. */
  const onFile = Boolean(contact.name || contact.phone || contact.relationship);

  const save = async () => {
    const trimmedPhone = phone.trim();

    /*
     * Stored exactly as written.
     *
     * This used to demand E.164 — a leading plus and a country code — on the
     * reasoning that a number nobody can dial is no use in a hurry. That
     * rejected "0533 395 5823" and "(415) 555-0134", which are how people
     * actually write a number, and a field that refuses the real answer does
     * not get a better one. It gets an empty field, which is the outcome the
     * rule was meant to prevent.
     *
     * A person reads this, not a dialler.
     */
    setError(null);
    setState("saving");

    /**
     * Awaited, which it was not before.
     *
     * The button turned green the instant it was pressed, whether or not the
     * write ever landed — so a failure was indistinguishable from success, and
     * the number somebody entered for an emergency was not there when it
     * mattered. Nothing about that is visible from inside the app.
     */
    try {
      await onSave({
        name: name.trim() || null,
        phone: trimmedPhone || null,
        relationship: relationship.trim() || null,
      });
      setState("saved");
      setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("idle");
      setError("That did not save. Check your connection and try again.");
    }
  };

  return (
    <div className="rounded-2xl p-4" style={{ border: "1px solid #E7EEF6" }}>
      <div className="flex items-start gap-2.5">
        <ShieldCheck size={15} color="#3B9BE8" className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="font-body font-medium text-[14.5px] text-navy">
            Emergency contact — optional
          </p>
          <p className="font-body font-normal text-[14px] mt-1 leading-relaxed text-ink-soft">
            Someone we can call if something goes wrong during a session. Nobody you book with ever
            sees this — only our team, and only if there is an emergency.
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        <Field label="Name" value={name} onChange={setName} placeholder="Who should we call?" />
        <Field
          label="Phone"
          value={phone}
          onChange={setPhone}
          placeholder="Their number"
          icon={<Phone size={13} color="#8CA3BD" />}
          inputMode="tel"
        />
        <Field
          label="Relationship"
          value={relationship}
          onChange={setRelationship}
          placeholder="Partner, parent, friend…"
        />
      </div>

      {error && (
        <p className="font-body font-normal text-[13.5px] mt-2 text-coral-deep">{error}</p>
      )}

      {/*
        The label says what is true, not what was pressed.
        An untouched empty form used to read "Saved", which is the app claiming
        to hold a number nobody had given it — and the one moment that lie
        costs something is the one moment nobody is looking at the screen.
      */}
      <button
        type="button"
        onClick={() => void save()}
        disabled={!dirty || state === "saving"}
        className="w-full mt-3 py-2.5 rounded-xl font-body font-medium text-[15px] press"
        style={
          dirty && state !== "saving"
            ? { backgroundColor: "#16304E", color: "#fff" }
            : { border: "1px solid #DCE7F2", color: state === "saved" ? "#4F6B4F" : "#5D768F" }
        }
      >
        {state === "saving"
          ? "Saving…"
          : state === "saved"
            ? "Saved"
            : dirty
              ? "Save contact"
              : onFile
                ? "Saved"
                : "Nothing saved yet"}
      </button>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  icon,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  icon?: React.ReactNode;
  inputMode?: "tel" | "text";
}) {
  return (
    <div
      className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-white"
      style={{ border: "1px solid #DCE7F2" }}
    >
      {icon}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={`Emergency contact ${label.toLowerCase()}`}
        inputMode={inputMode}
        autoComplete="off"
        className="font-body text-[14.5px] outline-none w-full text-navy bg-transparent"
      />
    </div>
  );
}
