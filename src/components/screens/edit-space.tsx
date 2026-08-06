"use client";

import { useState } from "react";
import { AlertTriangle, ArrowLeft } from "lucide-react";

import { DocumentStatus } from "@/components/document-status";
import { PrimaryButton } from "@/components/primitives";
import type { HostSpace, SpaceEdit } from "@/lib/domain";
import { formatCents, quote } from "@/lib/money";
import { CATEGORY_KEYS, roomTypeFor } from "@/lib/taxonomy";

/**
 * Editing a listing that already exists.
 *
 * Until now there was no way to change one. A wrong rate or an old door code
 * meant delisting and starting again, which throws away the reviews and the
 * history along with the mistake.
 *
 * What a host may change, and what it costs, is one sentence: a change must
 * never rewrite something somebody has already agreed to. Everything on this
 * screen is that sentence applied to a field, and the screen says which is
 * which before the change is made rather than after it is refused.
 */
export function EditSpace({
  space,
  bookedSessions,
  onSave,
  onBack,
}: {
  space: HostSpace;
  /** Sessions still ahead on this listing. Locks the address and room type. */
  bookedSessions: number;
  onSave: (edit: SpaceEdit) => Promise<unknown>;
  onBack: () => void;
}) {
  const [name, setName] = useState(space.name);
  const [rate, setRate] = useState(String(Math.round(space.hourlyRateCents / 100)));
  const [capacity, setCapacity] = useState(String(space.capacity));
  const [entry, setEntry] = useState(space.entryInstructions);
  const [buffer, setBuffer] = useState(String(space.bufferMinutes));
  const [category, setCategory] = useState(space.category);
  const [address, setAddress] = useState(space.addressLine);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rateCents = Math.round(Number(rate) * 100);
  const rateIsNumber = rate.trim() !== "" && Number.isFinite(rateCents) && rateCents > 0;

  const locked = bookedSessions > 0;
  const moving = !locked && (address !== space.addressLine || category !== space.category);

  const changed =
    name !== space.name ||
    (rateIsNumber && rateCents !== space.hourlyRateCents) ||
    Number(capacity) !== space.capacity ||
    entry !== space.entryInstructions ||
    Number(buffer) !== space.bufferMinutes ||
    category !== space.category ||
    address !== space.addressLine;

  const save = async () => {
    if (!rateIsNumber) {
      setError("Enter an hourly rate.");
      return;
    }

    setError(null);
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        hourlyRateCents: rateCents,
        capacity: Number(capacity),
        entryInstructions: entry.trim(),
        bufferMinutes: Number(buffer),
        // Only sent when they are actually free to change, so a locked
        // listing cannot be moved by a stale value sitting in a field.
        ...(locked ? {} : { category, addressLine: address.trim() }),
      });
      onBack();
    } catch (cause) {
      setSaving(false);
      setError(cause instanceof Error ? cause.message : "That did not save.");
    }
  };

  return (
    <div className="h-full flex flex-col screen-in bg-white">
      <div className="px-6 pt-8 pb-5 shrink-0 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="w-9 h-9 rounded-full flex items-center justify-center press shrink-0"
          style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
        >
          <ArrowLeft size={16} color="#16304E" />
        </button>
        <div className="min-w-0">
          <p className="font-display italic font-semibold text-[19px] truncate text-navy">
            {space.name}
          </p>
          <p className="font-body font-normal text-[13.5px] text-ink-faint">
            {roomTypeFor(space.category)}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-8">
        <Label>Space name</Label>
        <Text value={name} onChange={setName} />

        <Label>Hourly rate (you keep this)</Label>
        <div className="flex items-center gap-1 rounded-xl px-3.5 py-3" style={FIELD}>
          <span className="font-body font-medium text-[15px] text-navy">$</span>
          <input
            value={rate}
            onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))}
            inputMode="decimal"
            aria-label="Hourly rate in dollars"
            className="font-body text-[15px] outline-none w-full text-navy"
          />
        </div>
        <p className="font-body font-normal text-[13.5px] mt-1.5 text-ink-faint">
          {rateIsNumber
            ? `Lists at ${formatCents(quote({ hostRateCents: rateCents, isInstant: false, isPro: false }).totalCents)}/hr`
            : "Lists at —"}
        </p>
        {/*
          Bookings freeze their own money when they are made, so a rate change
          cannot reach one that already exists. Worth saying plainly: a host
          raising their rate should not be wondering whether they have just
          overcharged somebody who booked last week.
        */}
        {rateIsNumber && rateCents !== space.hourlyRateCents && (
          <Note>Sessions already booked keep the price they were booked at.</Note>
        )}

        <Label>Capacity</Label>
        <Text value={capacity} onChange={(v) => setCapacity(v.replace(/[^\d]/g, ""))} />

        <Label>How does a practitioner get in?</Label>
        <Text value={entry} onChange={setEntry} multiline />

        <Label>Turnover buffer (minutes)</Label>
        <Text value={buffer} onChange={(v) => setBuffer(v.replace(/[^\d]/g, ""))} />

        <div className="h-px my-7" style={{ backgroundColor: "#E7EEF6" }} />

        {locked ? (
          /*
           * Refused, not re-reviewed. Somebody has arranged their day around a
           * room at this address; moving it underneath them is the harm the
           * cancellation policy exists to prevent, done quietly instead of
           * with a notification. Shown as a locked state rather than as a
           * field that throws when saved.
           */
          <div
            className="rounded-xl px-3.5 py-3 flex items-start gap-2.5"
            style={{ backgroundColor: "#FFF8F1", border: "1px solid #F5DFC4" }}
          >
            <AlertTriangle size={14} color="#8B6C37" className="mt-0.5 shrink-0" />
            <div>
              <p className="font-body font-medium text-[14px] text-navy">
                Address and room type are locked
              </p>
              <p className="font-body font-normal text-[13.5px] mt-0.5 leading-relaxed text-ink-soft">
                {bookedSessions === 1
                  ? "One session is booked here."
                  : `${bookedSessions} sessions are booked here.`}{" "}
                They can change once those are done.
              </p>
            </div>
          </div>
        ) : (
          <>
            <Label>Room type</Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setCategory(key)}
                  className="px-3.5 py-2 rounded-full font-body text-[13.5px] press"
                  style={
                    category === key
                      ? { backgroundColor: "#2578C2", color: "#fff" }
                      : { border: "1px solid #DCE7F2", color: "#4D6480" }
                  }
                >
                  {roomTypeFor(key)}
                </button>
              ))}
            </div>

            <Label>Location</Label>
            <Text value={address} onChange={setAddress} />

            {moving && (
              <Note tone="warn">
                Changing the address or room type takes this listing off search until we have
                checked it again.
              </Note>
            )}
          </>
        )}

        <div className="h-px my-7" style={{ backgroundColor: "#E7EEF6" }} />

        <p className="font-body font-medium text-[11px] uppercase tracking-[0.2em] mb-3 text-sky-text">
          Your documents
        </p>
        <div className="flex flex-col gap-2.5">
          <DocumentStatus
            label="Proof you can sublease"
            fileName={space.subleaseDocName}
            review={space.subleaseReview}
            note={space.reviewNote}
          />
          <DocumentStatus
            label="Space insurance"
            fileName={space.insuranceDocName}
            review={space.insuranceReview}
            optional
          />
        </div>

        {error && (
          <p className="font-body font-normal text-[13.5px] mt-4 text-coral-deep">{error}</p>
        )}

        <div className="mt-6">
          <PrimaryButton onClick={() => void save()} disabled={!changed || saving}>
            {saving ? "Saving…" : changed ? "Save changes" : "Nothing changed"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

const FIELD = { border: "1px solid #DCE7F2", backgroundColor: "#fff" } as const;

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-body font-medium text-[11px] uppercase tracking-[0.2em] mt-6 mb-2 text-sky-text">
      {children}
    </p>
  );
}

function Note({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "warn" }) {
  return (
    <p
      className="font-body font-normal text-[13.5px] mt-2 leading-relaxed"
      style={{ color: tone === "warn" ? "#8B6C37" : "#566D85" }}
    >
      {children}
    </p>
  );
}

function Text({
  value,
  onChange,
  multiline = false,
}: {
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  const shared = "font-body text-[15px] outline-none w-full text-navy rounded-xl px-3.5 py-3";

  return multiline ? (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={3}
      className={`${shared} resize-none`}
      style={FIELD}
    />
  ) : (
    <input value={value} onChange={(e) => onChange(e.target.value)} className={shared} style={FIELD} />
  );
}
