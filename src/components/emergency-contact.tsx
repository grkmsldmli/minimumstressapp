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
  onSave: (contact: EmergencyContact) => void;
}) {
  const [name, setName] = useState(contact.name ?? "");
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [relationship, setRelationship] = useState(contact.relationship ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    name !== (contact.name ?? "") ||
    phone !== (contact.phone ?? "") ||
    relationship !== (contact.relationship ?? "");

  const save = () => {
    const trimmedPhone = phone.trim();

    /**
     * E.164, because the column requires it and because a number without a
     * country code is a number nobody can dial in a hurry. Checked here so the
     * message is about the phone rather than about a constraint.
     */
    if (trimmedPhone && !/^\+[1-9]\d{6,14}$/.test(trimmedPhone.replace(/[\s()-]/g, ""))) {
      setError("Include the country code, like +1 415 555 0134.");
      return;
    }

    setError(null);
    onSave({
      name: name.trim() || null,
      phone: trimmedPhone ? trimmedPhone.replace(/[\s()-]/g, "") : null,
      relationship: relationship.trim() || null,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="rounded-2xl p-4" style={{ border: "1px solid #E7EEF6" }}>
      <div className="flex items-start gap-2.5">
        <ShieldCheck size={15} color="#3B9BE8" className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="font-body font-medium text-[13px] text-navy">
            Emergency contact — optional
          </p>
          <p className="font-body font-light text-[11.5px] mt-1 leading-relaxed text-ink-soft">
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
          placeholder="+1 415 555 0134"
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
        <p className="font-body font-light text-[11px] mt-2 text-coral-deep">{error}</p>
      )}

      <button
        type="button"
        onClick={save}
        disabled={!dirty && !saved}
        className="w-full mt-3 py-2.5 rounded-xl font-body font-medium text-[12px] press"
        style={
          dirty
            ? { backgroundColor: "#16304E", color: "#fff" }
            : { border: "1px solid #DCE7F2", color: saved ? "#5E7D5E" : "#B0BFCF" }
        }
      >
        {saved ? "Saved" : dirty ? "Save contact" : "Saved"}
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
        className="font-body text-[13px] outline-none w-full text-navy bg-transparent"
      />
    </div>
  );
}
