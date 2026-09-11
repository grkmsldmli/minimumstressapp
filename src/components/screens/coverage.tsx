"use client";

import { useState } from "react";
import { ArrowLeft, Award, CalendarClock, Check, Clock, MapPin } from "lucide-react";

import { Ambient, Headline } from "@/components/brand";
import { PawLoader } from "@/components/paw-loader";
import { PrimaryButton, Toggle } from "@/components/primitives";
import type { ClassTemplate, CoverageRequest, CoverageRequestInput, RequestInterest } from "@/lib/domain";
import { formatCents } from "@/lib/money";
import { PRACTITIONER_PROFESSIONS } from "@/lib/professions";
import { type CivilDate, instantFrom } from "@/lib/timezone";
import { sessionDayLong, sessionTime, sessionZoneLabel } from "@/lib/when";
import { effectiveRequestState, requestStateLabel } from "@/lib/work/request-state";
import { GroupLabel } from "./practitioner-extras";

const NAVY = "radial-gradient(140% 120% at 15% 0%, #1E4066 0%, #16304E 85%)";
const INPUT = "w-full px-4 py-3 rounded-xl font-body text-[15px] text-navy outline-none";
const INPUT_STYLE = { border: "1px solid #DCE7F2" } as const;

function parseCivil(dateStr: string): CivilDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function parseMinutes(timeStr: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(timeStr);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/* ================================ Post ================================ */

export function CoveragePost({
  spaces,
  templates,
  saving,
  onSubmit,
  onBack,
}: {
  spaces: { id: string; name: string; timeZone: string }[];
  templates: ClassTemplate[];
  saving: boolean;
  onSubmit: (input: CoverageRequestInput) => void;
  onBack: () => void;
}) {
  const [spaceId, setSpaceId] = useState(spaces[0]?.id ?? "");
  const [templateId, setTemplateId] = useState("");
  const [title, setTitle] = useState("");
  const [profession, setProfession] = useState("");
  const [dateStr, setDateStr] = useState("");
  const [timeStr, setTimeStr] = useState("09:00");
  const [duration, setDuration] = useState("60");
  const [pay, setPay] = useState("");
  const [notes, setNotes] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) {
      setTitle(t.title);
      setProfession(t.profession ?? "");
      setDuration(String(t.durationMinutes));
    }
  };

  const space = spaces.find((s) => s.id === spaceId);
  const durationNum = Math.round(Number(duration));
  const payNum = pay.trim() === "" ? NaN : Math.round(Number(pay) * 100);
  const canSubmit =
    Boolean(space) &&
    title.trim().length >= 2 &&
    Boolean(dateStr) &&
    Boolean(timeStr) &&
    durationNum >= 15 &&
    durationNum <= 480 &&
    Number.isFinite(payNum) &&
    payNum >= 0;

  const submit = () => {
    setError(null);
    if (!space) {
      setError("Choose which space needs coverage.");
      return;
    }
    const civil = parseCivil(dateStr);
    const minutes = parseMinutes(timeStr);
    if (!civil || minutes == null) {
      setError("Pick a date and time.");
      return;
    }
    const startsAt = instantFrom(civil, minutes, space.timeZone);
    if (!startsAt) {
      setError("That time doesn't exist on that day (daylight saving). Pick another.");
      return;
    }
    if (startsAt.getTime() <= Date.now()) {
      setError("Pick a time in the future.");
      return;
    }
    onSubmit({
      spaceId,
      classTemplateId: templateId || null,
      title: title.trim(),
      profession: profession || null,
      startsAt,
      durationMinutes: durationNum,
      payCents: payNum,
      notes: notes.trim() || null,
      urgent,
    });
  };

  return (
    <div className="h-full flex flex-col screen-in bg-white">
      <div
        className="px-6 pt-8 safe-pt-8 pb-7 rounded-b-[30px] relative overflow-hidden shrink-0"
        style={{ background: NAVY }}
      >
        <Ambient />
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="w-9 h-9 rounded-full flex items-center justify-center press relative z-10"
          style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
        >
          <ArrowLeft size={17} color="#fff" />
        </button>
        <div className="mt-5 relative z-10">
          <Headline pre="Need" accent="coverage." size={24} light />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-8 safe-pb-8 space-y-3">
        {templates.length > 0 && (
          <div>
            <label className="font-body font-medium text-[13.5px] text-navy">Start from a template</label>
            <select
              value={templateId}
              onChange={(e) => applyTemplate(e.target.value)}
              aria-label="Class template"
              className={`${INPUT} mt-1.5 bg-white`}
              style={INPUT_STYLE}
            >
              <option value="">No template</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="font-body font-medium text-[13.5px] text-navy">Space</label>
          <select
            value={spaceId}
            onChange={(e) => setSpaceId(e.target.value)}
            aria-label="Space"
            className={`${INPUT} mt-1.5 bg-white`}
            style={INPUT_STYLE}
          >
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="font-body font-medium text-[13.5px] text-navy">Class name</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Reformer Flow 1"
            aria-label="Class name"
            className={`${INPUT} mt-1.5`}
            style={INPUT_STYLE}
          />
        </div>

        <div>
          <label className="font-body font-medium text-[13.5px] text-navy">Who can cover it</label>
          <select
            value={profession}
            onChange={(e) => setProfession(e.target.value)}
            aria-label="Profession needed"
            className={`${INPUT} mt-1.5 bg-white`}
            style={INPUT_STYLE}
          >
            <option value="">Any professional</option>
            {PRACTITIONER_PROFESSIONS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="font-body font-medium text-[13.5px] text-navy">Date</label>
            <input
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              aria-label="Date"
              className={`${INPUT} mt-1.5 bg-white`}
              style={INPUT_STYLE}
            />
          </div>
          <div className="flex-1">
            <label className="font-body font-medium text-[13.5px] text-navy">Start time</label>
            <input
              type="time"
              value={timeStr}
              onChange={(e) => setTimeStr(e.target.value)}
              aria-label="Start time"
              className={`${INPUT} mt-1.5 bg-white`}
              style={INPUT_STYLE}
            />
          </div>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="font-body font-medium text-[13.5px] text-navy">Duration (min)</label>
            <input
              value={duration}
              onChange={(e) => setDuration(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              aria-label="Duration in minutes"
              className={`${INPUT} mt-1.5`}
              style={INPUT_STYLE}
            />
          </div>
          <div className="flex-1">
            <label className="font-body font-medium text-[13.5px] text-navy">Pay ($)</label>
            <input
              value={pay}
              onChange={(e) => setPay(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              placeholder="e.g. 60"
              aria-label="Offered pay in dollars"
              className={`${INPUT} mt-1.5`}
              style={INPUT_STYLE}
            />
          </div>
        </div>

        <div>
          <label className="font-body font-medium text-[13.5px] text-navy">
            Notes <span className="font-normal text-ink-faint">(optional)</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Anything the professional should know"
            aria-label="Notes"
            className={`${INPUT} mt-1.5 resize-none`}
            style={INPUT_STYLE}
          />
        </div>

        <div
          className="flex items-center justify-between p-3.5 rounded-xl bg-white"
          style={{ border: "1px solid #E7EEF6" }}
        >
          <div className="pr-3">
            <p className="font-body font-medium text-[14px] text-navy">Urgent</p>
            <p className="font-body font-normal text-[12.5px] mt-0.5 text-ink-faint">
              Flag it so it stands out to available professionals
            </p>
          </div>
          <Toggle on={urgent} onClick={() => setUrgent((v) => !v)} label="Urgent" />
        </div>

        {error && (
          <p className="font-body font-normal text-[13px]" style={{ color: "#B45143" }} role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="px-6 pt-3 pb-6 safe-pb-6 shrink-0" style={{ borderTop: "1px solid #F0ECE0" }}>
        <PrimaryButton onClick={submit} disabled={!canSubmit || saving}>
          {saving ? "Posting…" : "Post coverage request"}
        </PrimaryButton>
      </div>
    </div>
  );
}

/* ================================ Detail ================================ */

function TrustChip({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-body font-medium text-[11.5px]"
      style={{ backgroundColor: "#EFF4EC", color: "#557255" }}
    >
      <Check size={11} /> {label}
    </span>
  );
}

function InterestCard({
  interest,
  requestOpen,
  busy,
  onConfirm,
}: {
  interest: RequestInterest;
  requestOpen: boolean;
  busy: boolean;
  onConfirm: (interestId: string) => void;
}) {
  const i = interest;
  const name = i.fullName ?? i.displayName;
  return (
    <div
      className="rounded-2xl bg-white p-4 mb-3"
      style={{ border: i.state === "confirmed" ? "1px solid #DCE6D6" : "1px solid #E7EEF6" }}
    >
      <div className="flex items-center gap-3">
        {i.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={i.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
        ) : (
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-body font-semibold text-[15px]"
            style={{ backgroundColor: "#EDF6FE", color: "#2670B0" }}
          >
            {name.charAt(0)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="font-body font-semibold text-[15px] text-navy truncate">{name}</p>
            {i.foundingPractitioner && <Award size={13} color="#2E7CC4" />}
          </div>
          <p className="font-body font-normal text-[13px] text-ink-faint">{i.craft}</p>
        </div>
        {i.state === "confirmed" && (
          <span
            className="px-2.5 py-1 rounded-full font-body font-medium text-[12px] shrink-0"
            style={{ backgroundColor: "#EFF4EC", color: "#557255" }}
          >
            Confirmed
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 mt-3">
        {i.identityVerified && <TrustChip label="ID verified" />}
        {i.insuranceVerified && <TrustChip label="Insured" />}
        {i.credentialReviewed && <TrustChip label="Licensed" />}
        {i.goodStanding && <TrustChip label="Good standing" />}
        <span className="inline-flex items-center gap-1 font-body text-[12px] text-ink-faint">
          {i.completedSessions} sessions
          {i.distanceLabel ? ` · ${i.distanceLabel}` : ""}
        </span>
      </div>

      {i.message && <p className="font-body font-normal text-[13.5px] text-ink-soft mt-3">{i.message}</p>}

      {requestOpen && i.state === "interested" && (
        <div className="mt-3.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => onConfirm(i.interestId)}
            className="w-full py-2.5 rounded-full font-body font-medium text-[14.5px] text-white press disabled:opacity-60"
            style={{ backgroundColor: "#2578C2" }}
          >
            {busy ? "Confirming…" : "Confirm for this class"}
          </button>
        </div>
      )}
    </div>
  );
}

export function CoverageDetail({
  request,
  interest,
  loadingInterest,
  busyInterestId,
  cancelling,
  onConfirm,
  onCancel,
  onBack,
}: {
  request: CoverageRequest;
  interest: RequestInterest[];
  loadingInterest: boolean;
  busyInterestId: string | null;
  cancelling: boolean;
  onConfirm: (interestId: string) => void;
  onCancel: () => void;
  onBack: () => void;
}) {
  const state = effectiveRequestState(request);
  const open = state === "open";
  const zone = sessionZoneLabel(request.startsAt, request.timeZone);

  return (
    <div className="h-full flex flex-col screen-in bg-white">
      <div
        className="px-6 pt-8 safe-pt-8 pb-7 rounded-b-[30px] relative overflow-hidden shrink-0"
        style={{ background: NAVY }}
      >
        <Ambient />
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="w-9 h-9 rounded-full flex items-center justify-center press relative z-10"
          style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
        >
          <ArrowLeft size={17} color="#fff" />
        </button>
        <div className="mt-5 relative z-10">
          <Headline pre="Your" accent="request." size={24} light />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-8 safe-pb-8">
        <div className="rounded-2xl bg-white p-4" style={{ border: "1px solid #E7EEF6" }}>
          <div className="flex items-start justify-between gap-3">
            <p className="font-body font-semibold text-[16px] text-navy">{request.title}</p>
            <span
              className="px-2.5 py-1 rounded-full font-body font-medium text-[12px] shrink-0"
              style={{ backgroundColor: "#F4F8FC", color: "#566D85" }}
            >
              {requestStateLabel(state)}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
            <span className="inline-flex items-center gap-1.5 font-body text-[13px] text-ink-soft">
              <CalendarClock size={13} color="#8BA3BD" />
              {sessionDayLong(request.startsAt, request.timeZone)}, {sessionTime(request.startsAt, request.timeZone)}
              {zone ? ` ${zone}` : ""}
            </span>
            <span className="inline-flex items-center gap-1.5 font-body text-[13px] text-ink-soft">
              <Clock size={13} color="#8BA3BD" />
              {Math.round((request.endsAt.getTime() - request.startsAt.getTime()) / 60000)} min
            </span>
            {request.spaceName && (
              <span className="inline-flex items-center gap-1.5 font-body text-[13px] text-ink-soft">
                <MapPin size={13} color="#8BA3BD" /> {request.spaceName}
              </span>
            )}
          </div>
          {request.notes && (
            <p className="font-body font-normal text-[13.5px] text-ink-soft mt-3">{request.notes}</p>
          )}
          <p className="font-display italic text-[17px] text-navy mt-3">{formatCents(request.payCents)}</p>
        </div>

        <div className="mt-6">
          <GroupLabel>Interested professionals</GroupLabel>
          {loadingInterest ? (
            <div className="py-8 flex justify-center">
              <PawLoader label="Loading…" />
            </div>
          ) : interest.length === 0 ? (
            <div
              className="rounded-2xl p-6 text-center"
              style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
            >
              <p className="font-display italic text-[16px] text-navy">No interest yet.</p>
              <p className="font-body font-normal text-[13.5px] text-ink-soft mt-1.5">
                Available professionals who match will appear here as they respond.
              </p>
            </div>
          ) : (
            interest.map((i) => (
              <InterestCard
                key={i.interestId}
                interest={i}
                requestOpen={open}
                busy={busyInterestId === i.interestId}
                onConfirm={onConfirm}
              />
            ))
          )}
        </div>
      </div>

      {(state === "open" || state === "draft") && (
        <div className="px-6 pt-3 pb-6 safe-pb-6 shrink-0" style={{ borderTop: "1px solid #F0ECE0" }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelling}
            className="w-full py-3 rounded-full font-body font-medium text-[15px] press disabled:opacity-60"
            style={{ backgroundColor: "#FEF2F0", color: "#B45143" }}
          >
            {cancelling ? "Cancelling…" : "Cancel this request"}
          </button>
        </div>
      )}
    </div>
  );
}
