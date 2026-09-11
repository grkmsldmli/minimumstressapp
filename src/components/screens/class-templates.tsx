"use client";

import { useState } from "react";
import { ArrowLeft, ChevronRight, Plus, Trash2 } from "lucide-react";

import { Ambient, Headline } from "@/components/brand";
import { PrimaryButton, Toggle } from "@/components/primitives";
import type { ClassTemplate, ClassTemplateInput } from "@/lib/domain";
import { PRACTITIONER_PROFESSIONS, professionLabel } from "@/lib/professions";

const NAVY = "radial-gradient(140% 120% at 15% 0%, #1E4066 0%, #16304E 85%)";

const INPUT = "w-full px-4 py-3 rounded-xl font-body text-[15px] text-navy outline-none";
const INPUT_STYLE = { border: "1px solid #DCE7F2" } as const;

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
  const [level, setLevel] = useState(initial.level ?? "");
  const [equipment, setEquipment] = useState(initial.equipment ?? "");
  const [duration, setDuration] = useState(String(initial.durationMinutes));
  const [maxParticipants, setMaxParticipants] = useState(
    initial.maxParticipants != null ? String(initial.maxParticipants) : "",
  );
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [arrivalNotes, setArrivalNotes] = useState(initial.arrivalNotes ?? "");
  const [requiresCredential, setRequiresCredential] = useState(initial.requiresCredential);

  const durationNum = Math.round(Number(duration));
  const canSave = title.trim().length >= 2 && durationNum >= 15 && durationNum <= 480;

  const submit = () => {
    if (!canSave) return;
    onSave({
      title: title.trim(),
      profession: profession || null,
      level: level.trim() || null,
      equipment: equipment.trim() || null,
      durationMinutes: durationNum,
      maxParticipants: maxParticipants.trim() ? Math.round(Number(maxParticipants)) : null,
      notes: notes.trim() || null,
      arrivalNotes: arrivalNotes.trim() || null,
      requiresCredential,
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
  };
}
