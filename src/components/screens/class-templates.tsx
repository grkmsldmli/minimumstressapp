"use client";

import { useState } from "react";
import { ArrowLeft, ChevronRight, Plus, Trash2 } from "lucide-react";

import { Ambient, Headline } from "@/components/brand";
import { PrimaryButton, Toggle } from "@/components/primitives";
import type { ClassTemplate, ClassTemplateInput, ProgrammingMode, SessionFormat } from "@/lib/domain";
import { PRACTITIONER_PROFESSIONS, professionLabel } from "@/lib/professions";
import { emptySessionDetails } from "@/lib/work/session-details";

const NAVY = "radial-gradient(140% 120% at 15% 0%, #1E4066 0%, #16304E 85%)";

const INPUT = "w-full px-4 py-3 rounded-xl font-body text-[15px] text-navy outline-none";
const INPUT_STYLE = { border: "1px solid #DCE7F2" } as const;

const SESSION_FORMATS: { key: SessionFormat; label: string }[] = [
  { key: "group", label: "Group" },
  { key: "private", label: "Private" },
  { key: "semiprivate", label: "Semi-private" },
  { key: "workshop", label: "Workshop" },
];

const PROGRAMMING_MODES: { key: ProgrammingMode; label: string }[] = [
  { key: "continue", label: "Continue the plan" },
  { key: "studio", label: "Studio's format" },
  { key: "design", label: "Design the session" },
];

function splitList(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function emptyInput(): ClassTemplateInput {
  return {
    title: "",
    profession: null,
    level: null,
    equipment: null,
    durationMinutes: 60,
    maxParticipants: null,
    notes: null,
    arrivalNotes: null,
    requiresCredential: false,
    defaultPayCents: null,
    ...emptySessionDetails(),
  };
}

function TemplateForm({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial: ClassTemplateInput;
  saving: boolean;
  onSave: (input: ClassTemplateInput) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [profession, setProfession] = useState(initial.profession ?? "");
  const [sessionFormat, setSessionFormat] = useState<SessionFormat>(initial.sessionFormat ?? "group");
  const [level, setLevel] = useState(initial.level ?? "");
  const [equipment, setEquipment] = useState(initial.equipment ?? "");
  const [duration, setDuration] = useState(String(initial.durationMinutes));
  const [defaultPay, setDefaultPay] = useState(
    initial.defaultPayCents != null ? String(Math.round(initial.defaultPayCents / 100)) : "",
  );
  const [maxParticipants, setMaxParticipants] = useState(
    initial.maxParticipants != null ? String(initial.maxParticipants) : "",
  );
  const [participantsExpected, setParticipantsExpected] = useState(
    initial.participantsExpected != null ? String(initial.participantsExpected) : "",
  );
  const [audience, setAudience] = useState(initial.audience ?? "");
  const [notes, setNotes] = useState(initial.teachingNotes ?? initial.notes ?? "");
  const [arrivalNotes, setArrivalNotes] = useState(initial.arrivalNotes ?? "");
  const [requiredQuals, setRequiredQuals] = useState(initial.requiredQualifications.join(", "));
  const [preferredQuals, setPreferredQuals] = useState(initial.preferredQualifications.join(", "));
  const [sessionGoal, setSessionGoal] = useState(initial.sessionGoal ?? "");
  const [clientExperience, setClientExperience] = useState(initial.clientExperience ?? "");
  const [accommodations, setAccommodations] = useState(initial.accommodations ?? "");
  const [programming, setProgramming] = useState<ProgrammingMode | "">(initial.programming ?? "");
  const [requiresCredential, setRequiresCredential] = useState(initial.requiresCredential);

  const showGroup = sessionFormat === "group" || sessionFormat === "semiprivate" || sessionFormat === "workshop";
  const showPrivate = sessionFormat === "private" || sessionFormat === "semiprivate";

  const durationNum = Math.round(Number(duration));
  const canSave = title.trim().length >= 2 && durationNum >= 15 && durationNum <= 480;

  const submit = () => {
    if (!canSave) return;
    onSave({
      title: title.trim(),
      profession: profession || null,
      level: showGroup ? level.trim() || null : null,
      equipment: showGroup ? equipment.trim() || null : null,
      durationMinutes: durationNum,
      maxParticipants: showGroup && maxParticipants.trim() ? Math.round(Number(maxParticipants)) : null,
      notes: null,
      arrivalNotes: arrivalNotes.trim() || null,
      requiresCredential,
      defaultPayCents: defaultPay.trim() ? Math.round(Number(defaultPay) * 100) : null,
      sessionFormat,
      participantsExpected:
        showGroup && participantsExpected.trim() ? Math.round(Number(participantsExpected)) : null,
      audience: showGroup ? audience.trim() || null : null,
      teachingNotes: showGroup ? notes.trim() || null : null,
      requiredQualifications: splitList(requiredQuals),
      preferredQualifications: splitList(preferredQuals),
      sessionGoal: showPrivate ? sessionGoal.trim() || null : null,
      clientExperience: showPrivate ? clientExperience.trim() || null : null,
      accommodations: showPrivate ? accommodations.trim() || null : null,
      programming: showPrivate && programming ? programming : null,
    });
  };

  return (
    <div className="space-y-3">
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
          aria-label="Profession that can cover this class"
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

      <div>
        <label className="font-body font-medium text-[13.5px] text-navy">Session format</label>
        <div className="grid grid-cols-2 gap-2 mt-1.5">
          {SESSION_FORMATS.map((f) => {
            const on = sessionFormat === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setSessionFormat(f.key)}
                aria-pressed={on}
                className="px-3 py-2.5 rounded-xl press font-body font-medium text-[13.5px] text-navy"
                style={{
                  border: on ? "1.5px solid #2578C2" : "1px solid #DCE7F2",
                  backgroundColor: on ? "#EDF6FE" : "#fff",
                }}
              >
                {f.label}
              </button>
            );
          })}
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
          <label className="font-body font-medium text-[13.5px] text-navy">
            Usual pay ($) <span className="font-normal text-ink-faint">(optional)</span>
          </label>
          <input
            value={defaultPay}
            onChange={(e) => setDefaultPay(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            placeholder="e.g. 60"
            aria-label="Usual coverage pay in dollars"
            className={`${INPUT} mt-1.5`}
            style={INPUT_STYLE}
          />
        </div>
      </div>

      {showGroup && (
        <>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="font-body font-medium text-[13.5px] text-navy">Expected</label>
              <input
                value={participantsExpected}
                onChange={(e) => setParticipantsExpected(e.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric"
                placeholder="e.g. 12"
                aria-label="Expected participants"
                className={`${INPUT} mt-1.5`}
                style={INPUT_STYLE}
              />
            </div>
            <div className="flex-1">
              <label className="font-body font-medium text-[13.5px] text-navy">Max people</label>
              <input
                value={maxParticipants}
                onChange={(e) => setMaxParticipants(e.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric"
                placeholder="Any"
                aria-label="Maximum participants"
                className={`${INPUT} mt-1.5`}
                style={INPUT_STYLE}
              />
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="font-body font-medium text-[13.5px] text-navy">Level</label>
              <input
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                placeholder="e.g. Intermediate"
                aria-label="Level"
                className={`${INPUT} mt-1.5`}
                style={INPUT_STYLE}
              />
            </div>
            <div className="flex-1">
              <label className="font-body font-medium text-[13.5px] text-navy">Equipment</label>
              <input
                value={equipment}
                onChange={(e) => setEquipment(e.target.value)}
                placeholder="e.g. Reformer"
                aria-label="Equipment"
                className={`${INPUT} mt-1.5`}
                style={INPUT_STYLE}
              />
            </div>
          </div>

          <div>
            <label className="font-body font-medium text-[13.5px] text-navy">
              Who it&apos;s for <span className="font-normal text-ink-faint">(optional)</span>
            </label>
            <input
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="e.g. Drop-in regulars"
              aria-label="Audience"
              className={`${INPUT} mt-1.5`}
              style={INPUT_STYLE}
            />
          </div>

          <div>
            <label className="font-body font-medium text-[13.5px] text-navy">
              Teaching notes <span className="font-normal text-ink-faint">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="What the class expects of whoever covers it"
              aria-label="Teaching notes"
              className={`${INPUT} mt-1.5 resize-none`}
              style={INPUT_STYLE}
            />
          </div>
        </>
      )}

      {showPrivate && (
        <>
          <div>
            <label className="font-body font-medium text-[13.5px] text-navy">
              Session goal <span className="font-normal text-ink-faint">(optional)</span>
            </label>
            <textarea
              value={sessionGoal}
              onChange={(e) => setSessionGoal(e.target.value)}
              rows={2}
              placeholder="Describe the session, never the client"
              aria-label="Session goal"
              className={`${INPUT} mt-1.5 resize-none`}
              style={INPUT_STYLE}
            />
          </div>
          <div>
            <label className="font-body font-medium text-[13.5px] text-navy">
              Client experience <span className="font-normal text-ink-faint">(optional)</span>
            </label>
            <input
              value={clientExperience}
              onChange={(e) => setClientExperience(e.target.value)}
              placeholder="e.g. New to reformer"
              aria-label="Client experience"
              className={`${INPUT} mt-1.5`}
              style={INPUT_STYLE}
            />
          </div>
          <div>
            <label className="font-body font-medium text-[13.5px] text-navy">
              Accommodations <span className="font-normal text-ink-faint">(optional)</span>
            </label>
            <input
              value={accommodations}
              onChange={(e) => setAccommodations(e.target.value)}
              placeholder="e.g. Low-impact preferred"
              aria-label="Accommodations"
              className={`${INPUT} mt-1.5`}
              style={INPUT_STYLE}
            />
          </div>
          <div>
            <label className="font-body font-medium text-[13.5px] text-navy">Programming</label>
            <div className="space-y-2 mt-1.5">
              {PROGRAMMING_MODES.map((p) => {
                const on = programming === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setProgramming(on ? "" : p.key)}
                    aria-pressed={on}
                    className="w-full text-left px-3 py-2.5 rounded-xl press font-body font-medium text-[13.5px] text-navy"
                    style={{
                      border: on ? "1.5px solid #2578C2" : "1px solid #DCE7F2",
                      backgroundColor: on ? "#EDF6FE" : "#fff",
                    }}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      <div>
        <label className="font-body font-medium text-[13.5px] text-navy">
          Required qualifications <span className="font-normal text-ink-faint">(comma separated)</span>
        </label>
        <input
          value={requiredQuals}
          onChange={(e) => setRequiredQuals(e.target.value)}
          placeholder="e.g. Reformer cert, current insurance"
          aria-label="Required qualifications"
          className={`${INPUT} mt-1.5`}
          style={INPUT_STYLE}
        />
      </div>

      <div>
        <label className="font-body font-medium text-[13.5px] text-navy">
          Preferred qualifications <span className="font-normal text-ink-faint">(comma separated)</span>
        </label>
        <input
          value={preferredQuals}
          onChange={(e) => setPreferredQuals(e.target.value)}
          placeholder="e.g. Prenatal experience"
          aria-label="Preferred qualifications"
          className={`${INPUT} mt-1.5`}
          style={INPUT_STYLE}
        />
      </div>

      <div>
        <label className="font-body font-medium text-[13.5px] text-navy">
          Arrival notes <span className="font-normal text-ink-faint">(optional)</span>
        </label>
        <textarea
          value={arrivalNotes}
          onChange={(e) => setArrivalNotes(e.target.value)}
          rows={2}
          placeholder="Where to go, who to ask for"
          aria-label="Arrival notes"
          className={`${INPUT} mt-1.5 resize-none`}
          style={INPUT_STYLE}
        />
      </div>

      <div
        className="flex items-center justify-between p-3.5 rounded-xl bg-white"
        style={{ border: "1px solid #E7EEF6" }}
      >
        <div className="pr-3">
          <p className="font-body font-medium text-[14px] text-navy">Needs a verified credential</p>
          <p className="font-body font-normal text-[12.5px] mt-0.5 text-ink-faint">
            Only professionals with a verified license can cover it
          </p>
        </div>
        <Toggle
          on={requiresCredential}
          onClick={() => setRequiresCredential((v) => !v)}
          label="Requires a verified credential"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-3 rounded-full font-body font-medium text-[15px] press"
          style={{ backgroundColor: "#F4F8FC", color: "#566D85" }}
        >
          Cancel
        </button>
        <div className="flex-1">
          <PrimaryButton onClick={submit} disabled={!canSave || saving}>
            {saving ? "Saving…" : "Save class"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

export function ClassTemplates({
  templates,
  saving,
  onCreate,
  onUpdate,
  onArchive,
  onBack,
}: {
  templates: ClassTemplate[];
  saving: boolean;
  onCreate: (input: ClassTemplateInput) => void;
  onUpdate: (id: string, input: ClassTemplateInput) => void;
  onArchive: (id: string) => void;
  onBack: () => void;
}) {
  // null = list; "new" = create form; a template = edit form.
  const [editing, setEditing] = useState<null | "new" | ClassTemplate>(null);

  const heroTitle = editing ? (editing === "new" ? "New" : "Edit") : "Class";
  const heroAccent = editing ? "class." : "templates.";

  return (
    <div className="h-full flex flex-col screen-in bg-white">
      <div
        className="px-6 pt-8 safe-pt-8 pb-7 rounded-b-[30px] relative overflow-hidden shrink-0"
        style={{ background: NAVY }}
      >
        <Ambient />
        <button
          type="button"
          onClick={editing ? () => setEditing(null) : onBack}
          aria-label="Back"
          className="w-9 h-9 rounded-full flex items-center justify-center press relative z-10"
          style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
        >
          <ArrowLeft size={17} color="#fff" />
        </button>
        <div className="mt-5 relative z-10">
          <Headline pre={heroTitle} accent={heroAccent} size={24} light />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-8 safe-pb-8">
        {editing ? (
          <TemplateForm
            initial={editing === "new" ? emptyInput() : toInput(editing)}
            saving={saving}
            onSave={(input) => {
              if (editing === "new") onCreate(input);
              else onUpdate(editing.id, input);
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <>
            {templates.length === 0 ? (
              <div
                className="rounded-2xl p-6 text-center"
                style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
              >
                <p className="font-display italic text-[16px] text-navy">No templates yet.</p>
                <p className="font-body font-normal text-[13.5px] text-ink-soft mt-1.5">
                  Save a class once and posting coverage for it is a few taps.
                </p>
              </div>
            ) : (
              templates.map((t) => (
                <div
                  key={t.id}
                  className="rounded-2xl bg-white p-4 mb-3 flex items-start gap-3"
                  style={{ border: "1px solid #E7EEF6" }}
                >
                  <button
                    type="button"
                    onClick={() => setEditing(t)}
                    className="flex-1 text-left press min-w-0"
                  >
                    <p className="font-body font-semibold text-[15px] text-navy truncate">{t.title}</p>
                    <p className="font-body font-normal text-[13px] text-ink-faint mt-0.5">
                      {[
                        professionLabel(t.profession) ?? "Any professional",
                        `${t.durationMinutes} min`,
                        t.level || null,
                        t.maxParticipants ? `max ${t.maxParticipants}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => onArchive(t.id)}
                    aria-label={`Archive ${t.title}`}
                    className="w-8 h-8 rounded-full flex items-center justify-center press shrink-0"
                    style={{ backgroundColor: "#FEF2F0" }}
                  >
                    <Trash2 size={14} color="#B45143" />
                  </button>
                  <ChevronRight size={16} color="#B9CBDD" className="mt-1.5 shrink-0" />
                </div>
              ))
            )}
          </>
        )}
      </div>

      {!editing && (
        <div className="px-6 pt-3 pb-6 safe-pb-6 shrink-0" style={{ borderTop: "1px solid #F0ECE0" }}>
          <PrimaryButton onClick={() => setEditing("new")}>
            <span className="inline-flex items-center gap-1.5">
              <Plus size={15} /> New class template
            </span>
          </PrimaryButton>
        </div>
      )}
    </div>
  );
}

function toInput(t: ClassTemplate): ClassTemplateInput {
  return {
    title: t.title,
    profession: t.profession,
    level: t.level,
    equipment: t.equipment,
    durationMinutes: t.durationMinutes,
    maxParticipants: t.maxParticipants,
    notes: t.notes,
    arrivalNotes: t.arrivalNotes,
    requiresCredential: t.requiresCredential,
    defaultPayCents: t.defaultPayCents,
    sessionFormat: t.sessionFormat,
    participantsExpected: t.participantsExpected,
    audience: t.audience,
    teachingNotes: t.teachingNotes,
    requiredQualifications: t.requiredQualifications,
    preferredQualifications: t.preferredQualifications,
    sessionGoal: t.sessionGoal,
    clientExperience: t.clientExperience,
    accommodations: t.accommodations,
    programming: t.programming,
  };
}
