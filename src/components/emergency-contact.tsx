"use client";

import { ChevronRight, Phone, ShieldCheck } from "lucide-react";
import { useState } from "react";

import type { EmergencyContact } from "@/lib/domain";

/**
 * Somebody to reach if a session goes wrong while it is happening.
 *
 * Asked of both sides, for the same reason and with the same promise: the
 * counterpart never sees this — only staff can read it, through the same
 * boundary the verification documents sit behind. Optional, and it says so.
 *
 * Two presentations, one behaviour. The default is the full card (host). With
 * `collapsible`, it is a compact settings row that expands to the same form —
 * used on the practitioner settings page so it no longer fills the viewport.
 * Saving, validation and the API call are identical in both.
 */
export function EmergencyContactCard({
  contact,
  onSave,
  collapsible = false,
}: {
  contact: EmergencyContact;
  /** Resolves once it is stored. A rejection is shown, not swallowed. */
  onSave: (contact: EmergencyContact) => Promise<unknown> | void;
  /** Compact by default, expanding to the form — the practitioner presentation. */
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(false);
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
    // Stored exactly as written — a person reads this, not a dialler, so
    // "(415) 555-0134" is kept as typed rather than rejected for not being E.164.
    setError(null);
    setState("saving");
    // Awaited: the button used to turn green whether or not the write landed,
    // so a failure looked like success — for the one number that matters in a
    // hurry.
    try {
      await onSave({
        name: name.trim() || null,
        phone: phone.trim() || null,
        relationship: relationship.trim() || null,
      });
      setState("saved");
      setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("idle");
      setError("That did not save. Check your connection and try again.");
    }
  };

  // The full card (host) — unchanged.
  if (!collapsible) {
    return (
      <div className="rounded-2xl p-4" style={{ border: "1px solid #E7EEF6" }}>
        <div className="flex items-start gap-2.5">
          <ShieldCheck size={15} color="#3B9BE8" className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="font-body font-medium text-[14.5px] text-navy">
              Emergency contact — optional
            </p>
            <p className="font-body font-normal text-[14px] mt-1 leading-relaxed text-ink-soft">
              Someone we can call if something goes wrong during a session. Nobody you book with
              ever sees this — only our team, and only if there is an emergency.
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
                  : "Not added"}
        </button>
      </div>
    );
  }

  // Compact disclosure (practitioner) — same form, collapsed by default.
  return (
    <div className="rounded-xl bg-white" style={{ border: "1px solid #E7EEF6" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 p-3.5 press text-left"
      >
        <ShieldCheck size={15} color="#3B9BE8" />
        <span className="flex-1 font-body font-medium text-[14.5px] text-navy">Emergency contact</span>
        <span
          className="font-body font-normal text-[13.5px]"
          style={{ color: onFile ? "#557255" : "#8CA3BD" }}
        >
          {onFile ? "Added" : "Not added"}
        </span>
        <ChevronRight
          size={14}
          color="#B9CBDD"
          style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}
        />
      </button>

      {open && (
        <div className="px-3.5 pb-3.5 pt-0.5" style={{ borderTop: "1px solid #EEF3F8" }}>
          <p className="font-body font-normal text-[13.5px] leading-relaxed mt-2 text-ink-soft">
            Someone we can contact if there&apos;s an emergency during a booking.
          </p>

          <div className="mt-3 flex flex-col gap-2">
            <Field label="Name" value={name} onChange={setName} placeholder="Name" />
            <Field
              label="Phone number"
              value={phone}
              onChange={setPhone}
              placeholder="Phone number"
              icon={<Phone size={13} color="#8CA3BD" />}
              inputMode="tel"
            />
            <Field
              label="Relationship"
              value={relationship}
              onChange={setRelationship}
              placeholder="Relationship"
            />
          </div>

          {error && (
            <p className="font-body font-normal text-[13.5px] mt-2 text-coral-deep">{error}</p>
          )}

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
            {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Save contact"}
          </button>

          <p className="font-body font-normal text-[12px] leading-relaxed mt-2 text-ink-faint">
            Only the Minimum Stress team can access this information when needed.
          </p>
        </div>
      )}
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
