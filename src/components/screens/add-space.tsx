"use client";

import { useEffect, useRef, useState } from "react";
import {
  Accessibility,
  ArrowLeft,
  Bath,
  Check,
  DollarSign,
  Home,
  ShieldCheck,
  Timer,
  Users,
} from "lucide-react";

import { Ambient, BreathingLogo, CatIcon, Headline } from "@/components/brand";
import { DroppedPin, MapBackdrop } from "@/components/map";
import { ConfettiBurst, PrimaryButton } from "@/components/primitives";
import {
  AddMediaTile,
  MediaTile,
  type PickedMedia,
  createPickedMedia,
  releasePickedMedia,
} from "@/components/uploads";
import { DocumentUpload } from "@/components/uploads";
import { WeekSchedule } from "@/components/week-schedule";
import type { AvailabilityBlock } from "@/lib/availability";
import { isValidSchedule } from "@/lib/availability";
import type { NewSpaceInput } from "@/lib/domain";
import { formatCents, isViableHostRate, minViableHostRateCents, quote } from "@/lib/money";
import {
  ACCESS_TYPES,
  AMENITIES,
  BUFFER_OPTIONS,
  CATEGORIES,
  type AccessTypeKey,
  type CategoryKey,
  RESTROOM_OPTIONS,
  type RestroomOption,
  formatBuffer,
} from "@/lib/taxonomy";

const MAX_MEDIA = 6;
const STEP_LABELS = ["Basics", "Photos & extras", "Verify"] as const;

export function AddSpace({
  onBack,
  onListed,
}: {
  onBack: () => void;
  onListed: (input: NewSpaceInput) => Promise<void>;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(1);
  const [listed, setListed] = useState(false);

  // Step 1 — every field here is required by the brief.
  const [name, setName] = useState("");
  const [pin, setPin] = useState<{ x: number; y: number } | null>(null);
  const [address, setAddress] = useState("");
  const [category, setCategory] = useState<CategoryKey | null>(null);
  const [rate, setRate] = useState("");
  const [capacity, setCapacity] = useState("");
  const [accessType, setAccessType] = useState<AccessTypeKey | null>(null);
  const [entryInstructions, setEntryInstructions] = useState("");

  // Step 2 — only the media is required.
  const [media, setMedia] = useState<PickedMedia[]>([]);
  const [amenities, setAmenities] = useState<string[]>([]);
  const [accessible, setAccessible] = useState<boolean | null>(null);
  const [restroom, setRestroom] = useState<RestroomOption | null>(null);
  const [blocks, setBlocks] = useState<AvailabilityBlock[]>([]);
  const [bufferMinutes, setBufferMinutes] = useState<number>(0);

  // Step 3
  const [subleaseDoc, setSubleaseDoc] = useState<File | null>(null);
  const [insuranceDoc, setInsuranceDoc] = useState<File | null>(null);
  const [agreed, setAgreed] = useState(false);

  // Release every preview URL when the wizard unmounts, whether the listing
  // was submitted or abandoned.
  useEffect(
    () => () => {
      for (const item of media) releasePickedMedia(item);
    },
    // Intentionally on unmount only; removals revoke their own URL below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const rateCents = Math.round(Number(rate) * 100);
  const rateIsNumber = rate !== "" && Number.isFinite(Number(rate)) && rateCents > 0;

  const canStep1 =
    name.trim() !== "" &&
    pin !== null &&
    address.trim() !== "" &&
    category !== null &&
    rateIsNumber &&
    isViableHostRate(rateCents) &&
    Number(capacity) > 0 &&
    accessType !== null &&
    entryInstructions.trim() !== "";
  const canStep2 = media.length >= 1 && isValidSchedule(blocks);
  const canSubmit = subleaseDoc !== null && agreed;
  const canAdvance = step === 1 ? canStep1 : step === 2 ? canStep2 : canSubmit;

  const placePin = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = mapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setPin({ x: Math.min(94, Math.max(6, x)), y: Math.min(92, Math.max(8, y)) });
  };

  const addMedia = (file: File) => {
    if (media.length >= MAX_MEDIA) return;
    setMedia((m) => [...m, createPickedMedia(file)]);
  };

  const removeMedia = (item: PickedMedia) => {
    releasePickedMedia(item);
    setMedia((m) => m.filter((i) => i.id !== item.id));
  };

  const submit = async () => {
    if (!canSubmit || !category || !accessType || !pin) return;
    await onListed({
      name: name.trim(),
      category,
      hourlyRateCents: rateCents,
      capacity: Number(capacity),
      accessType,
      entryInstructions: entryInstructions.trim(),
      addressLine: address.trim(),
      mapX: pin.x,
      mapY: pin.y,
      accessible,
      restroom,
      amenities,
      bufferMinutes,
      availability: blocks,
      media: media.map((m) => ({ url: m.url, kind: m.kind })),
      subleaseDocName: subleaseDoc!.name,
      insuranceDocName: insuranceDoc?.name ?? null,
    });
    setListed(true);
  };

  if (listed) {
    return (
      <div
        className="h-full flex flex-col items-center justify-center text-center px-9 screen-in relative overflow-hidden"
        style={{
          background: "radial-gradient(120% 90% at 50% 0%, #1E4066 0%, #16304E 55%, #0E2138 100%)",
        }}
      >
        <Ambient />
        <ConfettiBurst />
        <div className="relative z-10 flex flex-col items-center">
          <BreathingLogo size={120} />
          <div className="mt-6">
            <Headline pre="Space" accent="listed." size={26} light />
          </div>
          <p className="font-body font-light text-[13px] text-white/70 leading-relaxed mt-3">
            Your listing is in. We&apos;re reviewing your documents — usually the same day — and
            we&apos;ll let you know the moment a practitioner books an open hour.
          </p>
          <button
            type="button"
            onClick={onBack}
            className="mt-7 px-8 py-3.5 rounded-full font-body font-medium text-[13px] text-white press"
            style={{ backgroundColor: "#3B9BE8" }}
          >
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col screen-in bg-white">
      <div
        className="px-6 pt-8 pb-6 relative rounded-b-[30px] overflow-hidden shrink-0"
        style={{ background: "radial-gradient(140% 120% at 15% 0%, #1E4066 0%, #16304E 85%)" }}
      >
        <Ambient />
        <button
          type="button"
          onClick={() => (step === 1 ? onBack() : setStep(step - 1))}
          aria-label="Back"
          className="w-9 h-9 rounded-full flex items-center justify-center press relative z-10"
          style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
        >
          <ArrowLeft size={16} color="#fff" />
        </button>
        <div className="mt-3 relative z-10">
          <Headline pre="List a" accent="new space." size={22} light />
        </div>
        <p className="font-body font-light text-[11px] text-white/55 mt-1 relative z-10">
          Step {step} of 3 · {STEP_LABELS[step - 1]}
        </p>
        <div className="flex gap-1.5 mt-3 relative z-10">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="flex-1 h-[3px] rounded-full overflow-hidden"
              style={{ backgroundColor: "rgba(255,255,255,0.22)" }}
            >
              <div
                className="h-full rounded-full bg-white"
                style={{ width: n <= step ? "100%" : "0%", transition: "width 0.3s ease" }}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-8">
        {step === 1 && (
          <div className="card-in">
            <SectionLabel>Space name</SectionLabel>
            <TextInput value={name} onChange={setName} placeholder="e.g. Willow Reformer Studio" />

            <SectionLabel className="mt-6">Location</SectionLabel>
            <div
              ref={mapRef}
              onClick={placePin}
              className="relative rounded-2xl overflow-hidden cursor-crosshair"
              style={{ height: 150, border: "1px solid #E7EEF6" }}
            >
              <MapBackdrop />
              {pin ? (
                <DroppedPin x={pin.x} y={pin.y} />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span
                    className="px-3 py-1.5 rounded-full font-body text-[11px] text-white"
                    style={{ backgroundColor: "rgba(22,48,78,0.85)" }}
                  >
                    Tap the map to drop a pin
                  </span>
                </div>
              )}
            </div>

            <div
              className="flex items-center gap-2 mt-3 px-4 py-3 rounded-xl"
              style={{ border: "1px solid #DCE7F2" }}
            >
              <Home size={13} color="#8CA3BD" />
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Street address, city"
                aria-label="Street address"
                className="font-body text-[13px] outline-none w-full text-navy"
              />
            </div>
            <p className="font-body font-light text-[11px] mt-2 text-ink-faint">
              Only shown to a practitioner once they&apos;ve booked — never public.
            </p>

            <SectionLabel className="mt-6">Room type</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <Chip
                  key={c.key}
                  active={category === c.key}
                  onClick={() => setCategory(c.key)}
                >
                  <CatIcon cat={c.key} size={12} />
                  {c.roomType}
                </Chip>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 mt-5">
              <div>
                <FieldLabel>
                  Hourly rate <span className="text-ink-ghost">(you keep this)</span>
                </FieldLabel>
                <div
                  className="flex items-center gap-2 px-4 py-3 rounded-xl"
                  style={{ border: "1px solid #DCE7F2" }}
                >
                  <DollarSign size={13} color="#8CA3BD" />
                  <input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="decimal"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    placeholder="45"
                    aria-label="Hourly rate in dollars"
                    className="font-body text-[13px] outline-none w-full text-navy"
                  />
                </div>
                <p
                  className="font-body text-[10.5px] mt-1.5"
                  style={{ color: rateIsNumber ? "#3B9BE8" : "#B9CBDD" }}
                >
                  {rateIsNumber
                    ? `Lists at ${formatCents(quote({ hostRateCents: rateCents, isInstant: false, isPro: false, creditBalanceCents: 0 }).totalCents)}/hr`
                    : "Lists at —"}
                </p>
              </div>
              <div>
                <FieldLabel>Capacity</FieldLabel>
                <div
                  className="flex items-center gap-2 px-4 py-3 rounded-xl"
                  style={{ border: "1px solid #DCE7F2" }}
                >
                  <Users size={13} color="#8CA3BD" />
                  <input
                    type="number"
                    min="1"
                    inputMode="numeric"
                    value={capacity}
                    onChange={(e) => setCapacity(e.target.value)}
                    placeholder="3"
                    aria-label="Capacity"
                    className="font-body text-[13px] outline-none w-full text-navy"
                  />
                </div>
              </div>
            </div>

            {rateIsNumber && !isViableHostRate(rateCents) && (
              <p
                className="font-body font-light text-[11px] mt-2 rounded-xl p-3 leading-relaxed"
                style={{ backgroundColor: "#FEF2F0", border: "1px solid #F5C4BC", color: "#7A4A42" }}
              >
                A rate this low costs more to process than it earns. The minimum is{" "}
                {formatCents(minViableHostRateCents())} an hour.
              </p>
            )}

            {/* Required by the brief, and absent from the prototype's step 1. */}
            <SectionLabel className="mt-6">How does a practitioner get in?</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {ACCESS_TYPES.map((option) => (
                <Chip
                  key={option.key}
                  active={accessType === option.key}
                  onClick={() => setAccessType(option.key)}
                >
                  {option.label}
                </Chip>
              ))}
            </div>
            <textarea
              value={entryInstructions}
              onChange={(e) => setEntryInstructions(e.target.value)}
              placeholder="e.g. Keypad is on the right-hand door frame. Press # after the code."
              aria-label="Entry instructions"
              rows={3}
              className="w-full mt-3 px-4 py-3 rounded-xl font-body text-[13px] outline-none resize-none text-navy"
              style={{ border: "1px solid #DCE7F2" }}
            />
            <p className="font-body font-light text-[11px] mt-2 text-ink-faint">
              We generate a fresh door code for every booking, so you never hand the same code to
              two different people. These instructions go out with it.
            </p>

            <div
              className="mt-4 rounded-xl p-3 flex items-start gap-2"
              style={{ backgroundColor: "#EFF4EC", border: "1px solid #DCE6D6" }}
            >
              <Check size={12} color="#5E7D5E" className="mt-0.5 shrink-0" />
              <p className="font-body font-light text-[11px] leading-relaxed text-[#4A5D4A]">
                Whatever you set here is exactly what lands in your account. Our fee is added on top
                for the practitioner — never taken out of your rate.
              </p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="card-in">
            <SectionLabel>Photos &amp; video</SectionLabel>
            <div className="grid grid-cols-3 gap-2.5">
              {media.map((item) => (
                <MediaTile key={item.id} item={item} onRemove={() => removeMedia(item)} />
              ))}
              {media.length < MAX_MEDIA && (
                <AddMediaTile label={media.length === 0 ? "Cover" : "Add"} onPick={addMedia} />
              )}
            </div>
            <p className="font-body font-light text-[11px] mt-2 text-ink-faint">
              At least one photo or video to continue — up to {MAX_MEDIA}, mixed freely.
            </p>

            <SectionLabel className="mt-6">
              Amenities <OptionalTag />
            </SectionLabel>
            <div className="flex flex-wrap gap-2">
              {AMENITIES.map((amenity) => (
                <Chip
                  key={amenity}
                  active={amenities.includes(amenity)}
                  onClick={() =>
                    setAmenities((list) =>
                      list.includes(amenity)
                        ? list.filter((a) => a !== amenity)
                        : [...list, amenity],
                    )
                  }
                >
                  {amenity}
                </Chip>
              ))}
            </div>

            <FieldLabel className="mt-5">
              Wheelchair accessible <OptionalTag />
            </FieldLabel>
            <div className="flex gap-2">
              <Chip active={accessible === true} onClick={() => setAccessible(true)}>
                <Accessibility size={12} />
                Yes
              </Chip>
              <Chip active={accessible === false} onClick={() => setAccessible(false)}>
                No
              </Chip>
            </div>

            <FieldLabel className="mt-4">
              Restroom <OptionalTag />
            </FieldLabel>
            <div className="flex gap-2">
              {RESTROOM_OPTIONS.map((option) => (
                <Chip key={option} active={restroom === option} onClick={() => setRestroom(option)}>
                  {option === "Private" && <Bath size={12} />}
                  {option}
                </Chip>
              ))}
            </div>

            <SectionLabel className="mt-6">
              Availability <OptionalTag />
            </SectionLabel>
            <p className="font-body font-light text-[11px] mb-3 text-ink-faint">
              Turn on the days you&apos;re open. Each day can hold several separate blocks, so you
              can keep the gaps for your own use.
            </p>
            <WeekSchedule blocks={blocks} onChange={setBlocks} />

            <FieldLabel className="mt-5">
              Turnover time between bookings <OptionalTag />
            </FieldLabel>
            <div className="flex gap-2">
              {BUFFER_OPTIONS.map((minutes) => (
                <Chip
                  key={minutes}
                  active={bufferMinutes === minutes}
                  onClick={() => setBufferMinutes(minutes)}
                >
                  {minutes !== 0 && <Timer size={12} />}
                  {formatBuffer(minutes)}
                </Chip>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="card-in">
            <SectionLabel>Verify your space</SectionLabel>
            <div className="flex flex-col gap-3">
              <DocumentUpload
                label="Proof you can sublease"
                hint="Lease clause, landlord letter, or deed"
                required
                file={subleaseDoc}
                onPick={setSubleaseDoc}
                onRemove={() => setSubleaseDoc(null)}
              />
              <DocumentUpload
                label="Space insurance certificate"
                hint="PDF or photo"
                file={insuranceDoc}
                onPick={setInsuranceDoc}
                onRemove={() => setInsuranceDoc(null)}
              />
            </div>

            <button
              type="button"
              onClick={() => setAgreed((v) => !v)}
              aria-pressed={agreed}
              className="w-full flex items-start gap-3 mt-6 p-3.5 rounded-2xl text-left press"
              style={{
                backgroundColor: agreed ? "#EDF6FE" : "#F4F8FC",
                border: `1px solid ${agreed ? "#D4E8FA" : "#E7EEF6"}`,
              }}
            >
              <span
                className="w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5"
                style={{
                  backgroundColor: agreed ? "#3B9BE8" : "#fff",
                  border: `1px solid ${agreed ? "#3B9BE8" : "#DCE7F2"}`,
                }}
              >
                {agreed && <Check size={12} color="#fff" />}
              </span>
              <span className="font-body font-light text-[11.5px] leading-relaxed text-[#2E5578]">
                <ShieldCheck size={12} className="inline mr-1 -mt-0.5" color="#3B9BE8" />
                This space is legally available for paid wellness sessions, and I&apos;m responsible
                for anything damaged during a booking.
              </span>
            </button>

            <div
              className="mt-5 rounded-2xl p-4"
              style={{ backgroundColor: "#F9FAFB", border: "1px solid #E7EEF6" }}
            >
              <p className="font-body font-medium text-[11px] uppercase tracking-wide mb-2 text-ink-faint">
                You&apos;re about to list
              </p>
              <p className="font-body font-medium text-[13px] text-navy">
                {name.trim() || "Untitled space"}
              </p>
              <p className="font-body font-light text-[11.5px] mt-0.5 text-ink-soft">
                {CATEGORIES.find((c) => c.key === category)?.roomType} · fits {capacity || "?"}
              </p>
              <div className="h-px my-3" style={{ backgroundColor: "#E7EEF6" }} />
              <div className="flex items-center justify-between">
                <span className="font-body text-[11.5px] text-ink-soft">You keep</span>
                <span className="font-body font-semibold text-[15px] text-navy">
                  {formatCents(rateCents || 0)}/hr
                </span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="font-body text-[11.5px] text-ink-soft">Practitioners see</span>
                <span className="font-body text-[12.5px] text-ink-faint">
                  {rateIsNumber
                    ? formatCents(
                        quote({
                          hostRateCents: rateCents,
                          isInstant: false,
                          isPro: false,
                          creditBalanceCents: 0,
                        }).totalCents,
                      )
                    : "—"}
                  /hr
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="px-6 pt-3 pb-6 shrink-0" style={{ borderTop: "1px solid #F0ECE0" }}>
        <PrimaryButton
          disabled={!canAdvance}
          onClick={() => {
            if (step < 3) setStep(step + 1);
            else void submit();
          }}
        >
          {step === 3 ? "List this space" : "Continue"}
        </PrimaryButton>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SectionLabel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`font-body font-medium text-[10.5px] uppercase tracking-[0.2em] mb-2 text-sky ${className}`}
    >
      {children}
    </p>
  );
}

function FieldLabel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={`font-body text-[11px] mb-1.5 text-ink-soft ${className}`}>{children}</p>
  );
}

function OptionalTag() {
  return <span className="normal-case font-light text-ink-ghost">— optional</span>;
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className="w-full px-4 py-3 rounded-xl font-body text-[13px] outline-none text-navy"
      style={{ border: "1px solid #DCE7F2" }}
    />
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full font-body text-[12px] press"
      style={{
        backgroundColor: active ? "#3B9BE8" : "#FFFFFF",
        color: active ? "#fff" : "#16304E",
        border: `1px solid ${active ? "#3B9BE8" : "#DCE7F2"}`,
      }}
    >
      {children}
    </button>
  );
}
