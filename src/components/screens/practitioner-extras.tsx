"use client";

import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Bell,
  Briefcase,
  Check,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  FileCheck,
  FileUp,
  LogOut,
  Scale,
  ScrollText,
  ShieldCheck,
  X,
} from "lucide-react";

import { AccountBadge } from "@/components/account-badge";
import { AccountChange } from "@/components/account-change";
import { DeleteAccount } from "@/components/delete-account";
import { EmergencyContactCard } from "@/components/emergency-contact";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { Ambient, BreathingLogo, Headline } from "@/components/brand";
import { ConfettiBurst, PrimaryButton, Toggle } from "@/components/primitives";
import { SavedCard } from "@/components/saved-card";
import { StandingSummary } from "@/components/standing-notice";
import { shortName } from "@/components/document-status";
import { AvatarUpload, DocumentUpload } from "@/components/uploads";
import { SUPPORT_EMAIL } from "@/lib/company";
import type { AccountType, Profile } from "@/lib/domain";
import { PRACTITIONER_PROFESSIONS } from "@/lib/professions";
import { type InsuranceStatus, insuranceStatus } from "@/lib/insurance";
import { formatCoverageDate } from "@/lib/format-date";
import { errorMessage } from "@/lib/error-message";
import type { Standing } from "@/lib/reliability";
import type { MilestoneKey } from "@/lib/milestones";
import {
  BOOKING_HORIZON_DAYS,
  MAX_UPCOMING_BOOKINGS_FREE,
  PRO_BOOKING_HORIZON_DAYS,
  PRO_PRICE_CENTS,
  formatCents,
} from "@/lib/money";

import { NavyScreen } from "./shared";

/** The five-word status turned into the line shown on the profile row. */
const INSURANCE_LABEL: Record<InsuranceStatus, string> = {
  not_added: "Not added",
  pending_review: "In review",
  verified: "Verified",
  rejected: "Rejected — re-upload",
  expired: "Expired — renew",
};

/**
 * The insurance line on the settings row.
 *
 * Verified is the one state worth a mark of its own — it is the whole point of
 * the step, the thing that opens booking — so it carries the same green check a
 * verified document wears elsewhere in the app. Every other state stays a plain
 * grey word: "in review" or "expired" is a status, not something to dress up.
 */
function InsuranceRowValue({ status }: { status: InsuranceStatus }) {
  if (status === "verified") {
    return (
      <span className="inline-flex items-center gap-1" style={{ color: "#557255" }}>
        <CheckCircle2 size={13} />
        Verified
      </span>
    );
  }
  return <>{INSURANCE_LABEL[status]}</>;
}

/* ------------------------------------------------------------------ */
/*  Insurance upload — optional at onboarding, required before booking  */
/* ------------------------------------------------------------------ */

export function InsuranceUpload({
  onContinue,
  onBack,
  initialDocName,
  status = "not_added",
  reviewNote,
  effectiveDate,
  expiresAt,
}: {
  /**
   * Given the picked file, uploads it and moves on; given null, moves on
   * without a change (Skip, or Continue with nothing new to upload). Rejects
   * when the upload does not land, so this screen does not move on.
   */
  onContinue: (file: File | null) => Promise<unknown>;
  onBack?: () => void;
  initialDocName: string | null;
  /** Where the cover stands, so the screen can say more than "on file". */
  status?: InsuranceStatus;
  /** Staff's reason when a certificate was turned down, shown verbatim. */
  reviewNote?: string | null;
  /** The verified cover window, shown back once it is on record. */
  effectiveDate?: Date | null;
  expiresAt?: Date | null;
}) {
  const [file, setFile] = useState<File | null>(null);
  /*
   * What the file card shows. A freshly-picked file still has the name the
   * person chose it by, and showing it confirms they picked the right one. A
   * file already on record has only its storage path — a generated name behind
   * two ids — so it shows its type instead, the way host documents do (see
   * shortName). The raw path is never put on screen: it is nothing the
   * practitioner would recognise and half of it is somebody's account id.
   */
  const existingName = file ? file.name : initialDocName ? shortName(initialDocName) : null;
  const [saving, setSaving] = useState(false);
  /*
   * This screen used to record the policy and move on in the same breath. A
   * practitioner whose upload failed was carried into the app believing their
   * certificate was on file — which is the one thing here they would be asked
   * to produce if anything ever went wrong in a room.
   */
  const [saveError, setSaveError] = useState<string | null>(null);

  /*
   * Two states, not one screen that says everything at once. Before a file is
   * on record this is the optional upload step; once one is — and while it is
   * being reviewed — it is a short status, not a fresh pitch to add what is
   * already there. The upload, replacement, review and status logic is
   * unchanged; only what the screen says about them.
   */
  const hasCertOnFile = Boolean(initialDocName);

  // The on-file state's words, driven by where the cover actually stands, so a
  // pending certificate does not read the same as a verified or rejected one.
  const reviewCopy: Record<InsuranceStatus, { pre: string; accent: string; body: string }> = {
    not_added: {
      pre: "Your insurance is",
      accent: "under review.",
      body: "We'll let you know when it's verified. You can keep exploring spaces in the meantime.",
    },
    pending_review: {
      pre: "Your insurance is",
      accent: "under review.",
      body: "We'll let you know when it's verified. You can keep exploring spaces in the meantime.",
    },
    verified: {
      pre: "Your insurance is",
      accent: "verified.",
      body: "You're covered and can book a space.",
    },
    expired: {
      pre: "Your insurance has",
      accent: "expired.",
      body: "Upload a current certificate to book again.",
    },
    rejected: {
      pre: "Your insurance needs",
      accent: "another look.",
      body: reviewNote?.trim() || "Add a valid certificate and we'll review it again.",
    },
  };
  const onFileCopy = reviewCopy[status];

  const submit = (fileToSubmit: File | null) => {
    setSaveError(null);
    setSaving(true);
    void onContinue(fileToSubmit)
      .catch((cause) => setSaveError(errorMessage(cause, "That did not save. Try again.")))
      .finally(() => setSaving(false));
  };

  return (
    <NavyScreen>
      <div className="flex-1 flex flex-col justify-center px-8 relative z-10">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="w-9 h-9 rounded-full flex items-center justify-center press absolute left-8 top-8 z-20"
            style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
          >
            <ArrowLeft size={16} color="#fff" />
          </button>
        )}

        {hasCertOnFile ? (
          <>
            <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] text-sky-soft">
              Insurance
            </p>
            <div className="mt-2">
              <Headline pre={onFileCopy.pre} accent={onFileCopy.accent} size={27} light />
            </div>
            <p className="font-body font-normal text-[14px] leading-relaxed text-white/65 mt-3">
              {onFileCopy.body}
            </p>

            {/*
              The file already on record, with the way to swap it in place. Same
              picker the upload state uses — a replacement is a newly-picked
              File, submitted by Continue exactly as a first upload is.
            */}
            <div className="mt-6 rounded-2xl p-4 bg-white">
              <p className="font-body text-[13.5px] text-ink-soft mb-1.5">Certificate of insurance</p>
              <div
                className="flex items-center gap-2.5 px-4 py-3 rounded-xl"
                style={{ border: "1px solid #D4E8FA", backgroundColor: "#EDF6FE" }}
              >
                <FileCheck size={16} color="#3B9BE8" className="shrink-0" />
                <span className="font-body text-[13.5px] flex-1 truncate text-navy">{existingName}</span>
                <label className="font-body text-[13px] font-medium text-sky-text press cursor-pointer shrink-0">
                  Replace file
                  <input
                    type="file"
                    accept="application/pdf,image/*"
                    className="sr-only"
                    onChange={(e) => {
                      const picked = e.target.files?.[0];
                      if (picked) setFile(picked);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            </div>

            {/*
              The window a person can act on, once it is verified: when the
              cover runs from and — the date that matters — when it lapses and
              pauses their bookings again. Only shown when both are on record.
            */}
            {status === "verified" && effectiveDate && expiresAt && (
              <dl
                className="mt-3 rounded-2xl px-4 py-3.5 space-y-2"
                style={{ backgroundColor: "rgba(255,255,255,0.06)" }}
              >
                <div className="flex items-center justify-between gap-4">
                  <dt className="font-body text-[13px] text-white/55">Effective</dt>
                  <dd className="font-body text-[13.5px] text-white/85">
                    {formatCoverageDate(effectiveDate)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="font-body text-[13px] text-white/55">Expires</dt>
                  <dd className="font-body text-[13.5px] text-white/85">
                    {formatCoverageDate(expiresAt)}
                  </dd>
                </div>
              </dl>
            )}
          </>
        ) : (
          <>
            <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] text-sky-soft">
              Optional for now
            </p>
            <div className="mt-2">
              <Headline pre="Add your" accent="insurance" size={27} light />
            </div>
            <p className="font-body font-normal text-[14px] leading-relaxed text-white/65 mt-3">
              You&rsquo;ll need verified liability insurance before you can book a space.
            </p>

            <div className="mt-6 rounded-2xl p-4 bg-white">
              <DocumentUpload
                label="Certificate of insurance"
                hint="PDF or photo"
                file={file}
                onPick={setFile}
                onRemove={() => setFile(null)}
              />
            </div>
          </>
        )}

      </div>

      <div className="relative z-10 px-8 pb-9">
        {saveError && (
          <p
            className="font-body font-normal text-[14px] leading-relaxed mb-3 rounded-xl p-3"
            style={{ backgroundColor: "rgba(242,105,92,0.14)", color: "#F2A79E" }}
            role="alert"
          >
            {saveError}
          </p>
        )}

        <PrimaryButton
          disabled={saving || (!hasCertOnFile && !file)}
          onClick={() => submit(file)}
        >
          {saving ? "One moment…" : "Continue"}
        </PrimaryButton>
        {!hasCertOnFile && (
          <button
            type="button"
            onClick={() => submit(null)}
            disabled={saving}
            className="w-full mt-3 py-2 font-body font-medium text-[14px] press text-white/70"
          >
            Skip for now
          </button>
        )}
      </div>
    </NavyScreen>
  );
}

/* ------------------------------------------------------------------ */
/*  Professional credential — every profession provides proof to book   */
/* ------------------------------------------------------------------ */

/**
 * Submitting professional proof. Every practitioner provides some — the kind is
 * profession-specific (see proofLabel), and the booking gate refuses until it is
 * reviewed. The verdict is staff's; this screen only submits, and shows where
 * review stands with the factual labels (under review / reviewed / needs
 * attention). Never a quality or approval claim.
 */
export function CredentialUpload({
  proofLabel,
  initialDocName,
  state,
  reviewNote,
  initialType,
  initialNumber,
  initialJurisdiction,
  onSubmit,
  onBack,
}: {
  /** What this profession is asked for, e.g. "CAMTC certification". */
  proofLabel: string;
  initialDocName: string | null;
  state: "pending" | "verified" | "rejected" | null;
  reviewNote?: string | null;
  initialType?: string | null;
  initialNumber?: string | null;
  initialJurisdiction?: string | null;
  onSubmit: (
    file: File | null,
    details: {
      credentialType: string | null;
      credentialNumber: string | null;
      credentialJurisdiction: string | null;
    },
  ) => Promise<unknown>;
  onBack?: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState(initialType ?? "");
  const [number, setNumber] = useState(initialNumber ?? "");
  const [jurisdiction, setJurisdiction] = useState(initialJurisdiction ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existingName = file ? file.name : initialDocName ? shortName(initialDocName) : null;

  // The approved factual status labels: "Credential under review / reviewed /
  // needs attention" — never a quality or approval claim.
  const statusLine: Record<"pending" | "verified" | "rejected", { accent: string; body: string }> = {
    pending: { accent: "under review.", body: "We'll let you know when it's checked." },
    verified: {
      accent: "reviewed.",
      body: "It's on file, and hosts see it as reviewed.",
    },
    rejected: {
      accent: "needs attention.",
      body: reviewNote?.trim() || "Add a valid document and we'll review it again.",
    },
  };
  const shown = state ? statusLine[state] : null;

  const inputStyle = {
    border: "1px solid #DCE7F2",
  } as const;

  const submit = () => {
    setError(null);
    setSaving(true);
    void onSubmit(file, {
      credentialType: type.trim() || null,
      credentialNumber: number.trim() || null,
      credentialJurisdiction: jurisdiction.trim() || null,
    })
      .catch((cause) => setError(errorMessage(cause, "That did not save. Try again.")))
      .finally(() => setSaving(false));
  };

  return (
    <NavyScreen>
      <div className="flex-1 flex flex-col justify-center px-8 relative z-10">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="w-9 h-9 rounded-full flex items-center justify-center press absolute left-8 top-8 z-20"
            style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
          >
            <ArrowLeft size={16} color="#fff" />
          </button>
        )}

        <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] text-sky-soft">
          Credential
        </p>
        <div className="mt-2">
          <Headline
            pre={shown ? "Credential" : "Add your"}
            accent={shown ? shown.accent : "credential."}
            size={27}
            light
          />
        </div>
        <p className="font-body font-normal text-[14px] leading-relaxed text-white/65 mt-3">
          {shown
            ? shown.body
            : `We ask for ${proofLabel} before you can book. Add it and we'll review it.`}
        </p>

        <div className="mt-6 rounded-2xl p-4 bg-white space-y-3">
          <DocumentUpload
            label={proofLabel}
            hint="PDF or an image"
            required={!initialDocName}
            file={file}
            onPick={setFile}
            onRemove={() => setFile(null)}
          />
          {existingName && !file && (
            <p className="font-body text-[13px] text-ink-soft">On file: {existingName}</p>
          )}
          <input
            value={type}
            onChange={(e) => setType(e.target.value.slice(0, 80))}
            placeholder="Credential type (e.g. LMT)"
            className="w-full px-4 py-3 rounded-xl font-body text-[15px] text-navy outline-none"
            style={inputStyle}
          />
          <input
            value={number}
            onChange={(e) => setNumber(e.target.value.slice(0, 80))}
            placeholder="License or certificate number (if any)"
            className="w-full px-4 py-3 rounded-xl font-body text-[15px] text-navy outline-none"
            style={inputStyle}
          />
          <input
            value={jurisdiction}
            onChange={(e) => setJurisdiction(e.target.value.slice(0, 80))}
            placeholder="Issuing state (if any)"
            className="w-full px-4 py-3 rounded-xl font-body text-[15px] text-navy outline-none"
            style={inputStyle}
          />
        </div>

        {error && (
          <p
            className="font-body font-normal text-[14px] leading-relaxed mt-3 rounded-xl p-3"
            style={{ backgroundColor: "#FEF2F0", border: "1px solid #F5C4BC", color: "#7A4A42" }}
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="mt-6">
          <PrimaryButton disabled={saving || (!file && !initialDocName)} onClick={submit}>
            {saving ? "Saving…" : "Submit for review"}
          </PrimaryButton>
        </div>
      </div>
    </NavyScreen>
  );
}

/* ------------------------------------------------------------------ */
/*  Pro                                                                */
/* ------------------------------------------------------------------ */

/*
 * Pro sells room to work, never a cheaper hour.
 *
 * It used to lead with 10% off and a waived instant fee. Both were funded out
 * of a margin that is about a sixth of what a practitioner pays, so both got
 * more expensive the more somebody booked — Pro lost money from the third
 * session of the month, worst on exactly the person it was sold to.
 *
 * Everything here costs nothing per booking and earns more as somebody books
 * more. That is not a coincidence, it is the test each one had to pass.
 */
/**
 * What the two plans actually differ on, side by side.
 *
 * This was four paragraphs, one per benefit, each explaining the free limit in
 * a sentence before saying what Pro does about it. Every word was true and the
 * screen still did not answer the only question being asked — what do I get for
 * the money — because the reader had to hold the free number in their head
 * while reading the Pro one.
 *
 * Two columns answers it by sitting them next to each other. It also keeps the
 * screen honest: a row can only exist here if there is something real to put in
 * both cells, so a benefit the product does not have has nowhere to go.
 *
 * Every number is read from the constant the rule runs on. Typed out, they
 * would be right the day they were written and wrong the day a limit moved,
 * with nothing to catch it.
 */
const COMPARISON: { label: string; free: string | false; pro: string | true }[] = [
  {
    label: "Sessions at once",
    free: String(MAX_UPCOMING_BOOKINGS_FREE),
    pro: "Unlimited",
  },
  {
    label: "Book ahead",
    free: `${BOOKING_HORIZON_DAYS} days`,
    pro: `${PRO_BOOKING_HORIZON_DAYS} days`,
  },
  {
    label: "Book weeks at once",
    free: false,
    pro: true,
  },
  {
    /*
     * Sending the room, the hour and the street to whoever is coming with
     * them. The app never learns anything about that person — the phone's own
     * share sheet does the sending — which is why this can be a Pro line
     * without becoming a line about collecting somebody's number.
     */
    label: "Send details to your client",
    free: false,
    pro: true,
  },
  {
    /*
     * The one benefit that costs us anything, and it is bounded — see
     * resolveCancellation.
     *
     * "Cancel 24h ahead" against "Minus card fee" wrapped both cells on a
     * phone, which left this row taller than the other three and the table
     * looking broken. Part against Full is the same fact in words that fit,
     * and reads as a pair. What "part" leaves out — that the shortfall is the
     * card network's processing fee, not ours — belongs in the terms, where it
     * is stated in full.
     */
    label: "Cancel 24h ahead",
    free: "Minus fee",
    pro: "Full",
  },
];

/**
 * Which face the Pro screen shows, from server truth alone.
 *
 * The one rule that matters, and the bug this encodes against: "You're Pro" is
 * shown only when the server says so — `isPro`, set by the subscription webhook
 * — never because a checkout was opened, a redirect happened, or the app came
 * back to the foreground. `celebrate` is a fresh, server-confirmed upgrade and
 * only adds the confetti; `confirming` is the short wait while the webhook
 * catches up after a real payment. Free with nothing in flight is the offer.
 * There is no client flag that can grant Pro.
 */
export type ProView = "offer" | "confirming" | "active" | "celebrate";

export function proView(input: {
  isPro: boolean;
  confirming?: boolean;
  celebrate?: boolean;
}): ProView {
  if (input.isPro) return input.celebrate ? "celebrate" : "active";
  if (input.confirming) return "confirming";
  return "offer";
}

export function ProScreen({
  isPro,
  onBack,
  onSubscribe,
  celebrate = false,
  confirming = false,
}: {
  isPro: boolean;
  onBack: () => void;
  /** Opens checkout. Rejects only when the checkout could not be opened — it is
   *  never proof of payment, so it never shows the success screen. */
  onSubscribe: () => Promise<unknown>;
  /** A fresh, server-confirmed upgrade. Adds the confetti, shown once. */
  celebrate?: boolean;
  /** Returned from checkout, waiting on the webhook to confirm the payment. */
  confirming?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const view = proView({ isPro, confirming, celebrate });

  if (view === "active" || view === "celebrate") {
    return (
      <NavyScreen className="items-center justify-center text-center px-9">
        {view === "celebrate" && <ConfettiBurst />}
        <div className="relative z-10 flex flex-col items-center">
          <BreathingLogo size={120} />
          <div className="mt-6">
            <Headline pre="You're" accent="Pro." size={28} light />
          </div>
          <p className="font-body font-normal text-[14.5px] text-white/70 leading-relaxed mt-3">
            No limit on how many sessions you hold, {PRO_BOOKING_HORIZON_DAYS} days to plan
            ahead, whole terms booked in one go, and early cancellations cost you nothing.
          </p>
          <button
            type="button"
            onClick={onBack}
            className="mt-7 px-8 py-3.5 rounded-full font-body font-medium text-[14.5px] text-white press"
            style={{ backgroundColor: "#2578C2" }}
          >
            Done
          </button>
        </div>
      </NavyScreen>
    );
  }

  /*
   * Returned from Stripe and the payment is real, but the webhook that flips
   * is_pro has not landed yet. A brief, honest wait — never a fabricated
   * "You're Pro" — that resolves to the success screen once the server
   * confirms, or falls back to the offer if it never does.
   */
  if (view === "confirming") {
    return (
      <NavyScreen className="items-center justify-center text-center px-9">
        <div className="relative z-10 flex flex-col items-center">
          <BreathingLogo size={120} />
          <p className="font-body font-normal text-[15px] text-white/80 leading-relaxed mt-6">
            Confirming your subscription…
          </p>
          <p className="font-body font-normal text-[13.5px] text-white/55 leading-relaxed mt-2">
            This only takes a moment.
          </p>
          <button
            type="button"
            onClick={onBack}
            className="mt-7 font-body font-medium text-[14px] text-white/70 press"
          >
            Back
          </button>
        </div>
      </NavyScreen>
    );
  }

  return (
    <div className="h-full flex flex-col screen-in bg-white">
      <div
        className="px-6 pt-8 pb-9 relative rounded-b-[30px] overflow-hidden text-center shrink-0"
        style={{ background: "radial-gradient(140% 120% at 50% 0%, #1E4066 0%, #16304E 85%)" }}
      >
        <Ambient />
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="w-9 h-9 rounded-full flex items-center justify-center press absolute left-6 top-8 z-20"
          style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
        >
          <ArrowLeft size={16} color="#fff" />
        </button>
        <div className="relative z-10 pt-1">
          <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] text-sky-soft">
            Minimum Stress
          </p>
          <div className="mt-2 flex justify-center">
            <Headline pre="Go" accent="Pro." size={30} light />
          </div>
          <p className="font-display italic font-semibold text-white mt-3" style={{ fontSize: 38 }}>
            {formatCents(PRO_PRICE_CENTS)}
            <span className="font-body font-normal text-[15.5px] text-white/60">/mo</span>
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pt-6 pb-6">
        <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid #E7EEF6" }}>
          {/*
            The label column is wide enough for its longest label on one line.
            At 1.35fr three of the four wrapped, which left the rows different
            heights and the table looking like a mistake rather than a
            comparison.
          */}
          <div className="grid" style={{ gridTemplateColumns: "1.75fr 0.9fr 0.9fr" }}>
            <span />
            <span className="py-2.5 text-center font-body font-medium text-[13.5px] text-ink-soft">
              Free
            </span>
            <span
              className="py-2.5 text-center font-body font-semibold text-[13.5px] text-white"
              style={{ backgroundColor: "#2578C2" }}
            >
              Pro
            </span>

            {COMPARISON.map(({ label, free, pro }, i) => (
              <Fragment key={label}>
                <span
                  className="px-3 py-3 flex items-center font-body font-medium text-[14px] leading-snug text-navy"
                  style={{ borderTop: "1px solid #E7EEF6" }}
                >
                  {label}
                </span>
                <span
                  className="px-2 py-3 flex items-center justify-center text-center font-body font-normal text-[13.5px] text-ink-soft"
                  style={{ borderTop: "1px solid #E7EEF6" }}
                >
                  {free === false ? <X size={16} color="#B9CBDD" aria-label="No" /> : free}
                </span>
                <span
                  className="px-2 py-3 flex items-center justify-center text-center font-body font-medium text-[13.5px] text-navy"
                  style={{
                    borderTop: "1px solid #E7EEF6",
                    backgroundColor: "#EDF6FE",
                    // The tint runs to the bottom edge, so the column reads as
                    // one thing rather than four stacked cells.
                    borderBottomRightRadius: i === COMPARISON.length - 1 ? 15 : undefined,
                  }}
                >
                  {pro === true ? <Check size={16} color="#2578C2" aria-label="Yes" /> : pro}
                </span>
              </Fragment>
            ))}
          </div>
        </div>

        {/*
          One line in the room the table left, in the display face the app
          keeps for what it wants somebody to feel rather than parse. Not an
          explanation — the table is the explanation — and the benefit it names
          is the one nothing else here sells: a term booked once, instead of
          eight Tuesdays booked eight times.
        */}
        <p className="font-display italic font-semibold text-[21px] leading-snug text-center text-navy mt-9">
          Get <span className="text-sky-text">Pro Advantages</span>
        </p>
      </div>

      <div className="px-6 pb-7 shrink-0">
        {failed && (
          <p
            className="font-body font-normal text-[14px] leading-relaxed mb-3 rounded-xl p-3"
            style={{ backgroundColor: "#FEF2F0", border: "1px solid #F5C4BC", color: "#7A4A42" }}
            role="alert"
          >
            {failed}
          </p>
        )}

        <PrimaryButton
          disabled={busy}
          onClick={() => {
            // Only opens checkout. Success is never declared here — that would
            // be treating "checkout opened" as "paid". The screen turns Pro only
            // when the server confirms it (isPro), driven by the webhook.
            setFailed(null);
            setBusy(true);
            void onSubscribe()
              .catch((cause) =>
                setFailed(errorMessage(cause, "That did not go through. Nothing was charged.")),
              )
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "One moment…" : `Start Pro — ${formatCents(PRO_PRICE_CENTS)}/mo`}
        </PrimaryButton>
        <p className="text-center font-body font-normal text-[13.5px] mt-2.5 text-ink-faint">
          Cancel anytime.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Practitioner profile                                               */
/* ------------------------------------------------------------------ */

/**
 * "What you'll need to book" — the three requirements, and only what each one
 * factually confirms.
 *
 * Every line describes what the requirement is for, never a claim that Minimum
 * Stress certifies or approves the practitioner. It sets expectations before the
 * booking gate and says plainly that browsing needs none of it — the current
 * state of each requirement is shown in the rows beneath, so this does not
 * repeat it.
 */
function BookingRequirements() {
  const items = [
    { icon: ShieldCheck, label: "Identity", why: "Confirms the account belongs to you." },
    {
      icon: FileUp,
      label: "Liability insurance",
      why: "Helps protect you and the host if something goes wrong.",
    },
    {
      icon: FileCheck,
      label: "Professional proof",
      why: "Shows that your listed profession is supported by relevant documentation.",
    },
  ];

  return (
    <div
      className="rounded-2xl p-4 mb-2.5"
      style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
    >
      <p className="font-body font-semibold text-[13.5px] text-navy mb-3">What you&rsquo;ll need to book</p>
      <ul className="flex flex-col gap-3">
        {items.map(({ icon: Icon, label, why }) => (
          <li key={label} className="flex items-start gap-2.5">
            <Icon size={15} color="#3B9BE8" className="mt-0.5 shrink-0" />
            <div>
              <p className="font-body font-medium text-[14px] leading-snug text-navy">{label}</p>
              <p className="font-body font-normal text-[13px] leading-relaxed text-ink-soft mt-0.5">
                {why}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <p className="font-body font-normal text-[13px] leading-relaxed text-ink-faint mt-3.5">
        You can browse spaces now. Complete these before your first booking.
      </p>
    </div>
  );
}

export function PractitionerProfile({
  profile,
  onRefresh,
  bookingsCount,
  standing,
  onBack,
  onUpdate,
  onDeleteAccount,
  onPickAvatar,
  onGoLegal,
  onGoDisputes,
  disputesWaiting,
  onRequestAccountChange,
  onGoInsurance,
  onGoCredential,
  onVerifyIdentity,
  identityChecking = false,
  onSignOut,
}: {
  profile: Profile;
  /** Pull-to-refresh: re-fetches profile/account state in place. */
  onRefresh: () => Promise<unknown> | unknown;
  /** The moments reached so far, counted in app.tsx from bookings. */
  milestones: MilestoneKey[];
  /** What they have held, never what they spent. See milestones.ts. */
  milestoneTotal: string | null;
  bookingsCount: number;
  standing: Standing;
  onBack: () => void;
  onUpdate: (patch: Partial<Profile>) => Promise<unknown>;
  /** Completed, paid sessions. Drives the badges and nothing else. */
  sessions: number;
  /** Irreversible, and the screen says so before it runs. */
  onDeleteAccount: () => Promise<void>;
  /** Uploads the picture and resolves once it is stored, not once it is shown. */
  onPickAvatar: (file: File) => Promise<unknown>;
  onGoLegal: () => void;
  onGoDisputes: () => void;
  /** Asks staff to move this account to the other side. */
  onRequestAccountChange: (reason: string) => Promise<void>;
  /** How many refund requests or claims are waiting on this account. */
  disputesWaiting: number;
  onGoInsurance: () => void;
  /** Opens the credential upload screen. */
  onGoCredential: () => void;
  /** Opens the one-time identity check (hosted by Stripe). */
  onVerifyIdentity: () => void;
  /** True during the short wait after returning from Stripe, while the webhook lands. */
  identityChecking?: boolean;
  onSignOut: () => void;
}) {
  return (
    <div className="h-full flex flex-col screen-in bg-white">
      <ProfileHeader
        onBack={onBack}
        avatarUrl={profile.avatarUrl}
        onPickAvatar={onPickAvatar}
        accountType={profile.accountType}
        name={profile.displayName ?? ""}
        onName={(displayName) => onUpdate({ displayName })}
        sub={`${bookingsCount} booking${bookingsCount === 1 ? "" : "s"} so far${profile.email ? ` · ${profile.email}` : ""}`}
      />

      <PullToRefresh className="flex-1 px-6 pt-5 pb-8" onRefresh={onRefresh}>
        {/* Professional — first, because it gates booking eligibility. */}
        <GroupLabel>Professional</GroupLabel>

        {/*
          What booking will ask for, said once and up front, so the gate at the
          end is a reminder rather than a surprise. Factual only: each line is
          what the requirement confirms, never a claim that the platform vouches
          for the practitioner. The "why" lives here so the rows below can stay
          the plain current state without repeating it.
        */}
        <BookingRequirements />

        <div className="flex flex-col gap-2.5">
          <ProfileRow
            icon={FileUp}
            label="Liability insurance"
            // The status, not the filename: what a professional needs to know
            // here is whether they can book, and a file on record that is still
            // in review or has lapsed cannot. Derived from the stored review
            // state and the clock — see lib/insurance.ts.
            value={
              <InsuranceRowValue
                status={insuranceStatus(
                  {
                    hasCertificate: profile.insuranceDocName !== null,
                    state: profile.insuranceReview.state,
                    effectiveDate: profile.insuranceEffectiveDate,
                    expiresAt: profile.insuranceExpiresAt,
                  },
                  new Date(),
                )}
              />
            }
            onClick={onGoInsurance}
          />
          <ProfileRow
            icon={ShieldCheck}
            label="Identity"
            // Verified once, by Stripe; a fact, not a claim about their work.
            // "Checking…" is the neutral wait while the webhook lands on return —
            // never a client-side claim of success. Tappable only from a
            // settled, unverified state; nothing to do while verified or mid-check.
            value={
              identityChecking
                ? "Checking your verification…"
                : profile.identityVerifiedAt
                  ? "Verified"
                  : "Not verified"
            }
            onClick={
              profile.identityVerifiedAt || identityChecking ? undefined : onVerifyIdentity
            }
          />
          {/*
            Identity-verification helper copy. Short, factual, and honest about
            who holds what — see the Privacy note it mirrors. No ID image or
            document is ever shown in the app.
          */}
          <p className="font-body font-normal text-[12.5px] leading-relaxed px-1 text-ink-faint">
            We verify identity through Stripe, which collects and checks your ID and a
            selfie. We keep only whether you passed and a reference — never the images. To have
            your verification data deleted, email{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
          {/*
            What they do, from the controlled list. Display only for now, and the
            label a host reads on a request. A plain select rather than a screen —
            it is one choice, changed rarely.
          */}
          <div
            className="flex items-center gap-3 p-3.5 rounded-xl bg-white"
            style={{ border: "1px solid #E7EEF6" }}
          >
            <Briefcase size={15} color="#3B9BE8" className="shrink-0" />
            <label htmlFor="profession" className="flex-1 font-body font-medium text-[14.5px] text-navy">
              What you do
            </label>
            <select
              id="profession"
              value={profile.profession ?? ""}
              onChange={(event) => onUpdate({ profession: event.target.value || null })}
              className="font-body text-[13.5px] text-ink-soft bg-white"
            >
              <option value="">Choose…</option>
              {PRACTITIONER_PROFESSIONS.map((profession) => (
                <option key={profession.key} value={profession.key}>
                  {profession.label}
                </option>
              ))}
            </select>
          </div>
          {/*
            Every profession provides proof, so this always shows. The value is
            the factual review state, or a prompt to add proof when none is on
            file yet.
          */}
          <ProfileRow
            icon={FileCheck}
            label="Professional credential"
            value={
              profile.credentialReview.state === "verified"
                ? "Reviewed"
                : profile.credentialReview.state === "pending"
                  ? "Under review"
                  : profile.credentialReview.state === "rejected"
                    ? "Needs attention"
                    : "Required"
            }
            onClick={onGoCredential}
          />
        </div>

        <div className="mt-6">
          <GroupLabel>Bookings &amp; payments</GroupLabel>
        </div>
        <div className="flex flex-col gap-2.5">
          {/*
            The card is kept and can be charged off-session afterwards, so this
            is a screen rather than a label. Saying only where it is typed was
            silent about the part that matters: what can reach it later.
          */}
          <SavedCard isPro={profile.isPro} />
          {/*
            Shown with a count when something is waiting, because being asked
            to answer an accusation is not a thing to find by browsing.
          */}
          <ProfileRow
            icon={Scale}
            label="Refunds & claims"
            value={disputesWaiting > 0 ? `${disputesWaiting} waiting on you` : undefined}
            onClick={onGoDisputes}
          />
        </div>

        <div className="mt-6">
          <GroupLabel>Safety &amp; notifications</GroupLabel>
        </div>
        <div className="flex flex-col gap-2.5">
          {/*
            Not a toggle: everything a practitioner is emailed is about a session
            they paid for, so none of it is optional — stated in one line rather
            than offered as a switch that would not switch anything.
          */}
          <div
            className="flex items-start gap-3 px-3.5 py-2.5 rounded-xl bg-white"
            style={{ border: "1px solid #E7EEF6" }}
          >
            <Bell size={15} color="#3B9BE8" className="mt-0.5 shrink-0" />
            <div>
              <p className="font-body font-medium text-[14.5px] text-navy">Booking updates</p>
              <p className="font-body font-normal text-[13px] mt-0.5 text-ink-faint">
                Confirmations, access details and important changes.
              </p>
            </div>
          </div>
          <EmergencyContactCard
            collapsible
            contact={profile.emergencyContact}
            onSave={(emergencyContact) => onUpdate({ emergencyContact })}
          />
        </div>

        {/*
          Shown always, not only when something is wrong. A rule nobody can see
          until it costs them is a trap; this way "where do I stand" is a tap
          away on a good day too.
        */}
        <div className="mt-6">
          <GroupLabel>Account standing</GroupLabel>
        </div>
        <div className="flex flex-col gap-2.5">
          <StandingSummary party="practitioner" standing={standing} />
        </div>

        <div className="mt-6">
          <GroupLabel>Account &amp; legal</GroupLabel>
        </div>
        <div className="flex flex-col gap-2.5">
          <ProfileRow icon={ScrollText} label="Terms & privacy" onClick={onGoLegal} />
          {profile.accountType && (
            <AccountChange accountType={profile.accountType} onRequest={onRequestAccountChange} />
          )}
          <ProfileRow icon={LogOut} label="Log out" onClick={onSignOut} danger />
        </div>

        {/* Last, and on its own. Nothing here is undoable except this. */}
        <div className="mt-8">
          <DeleteAccount onDelete={onDeleteAccount} />
        </div>
      </PullToRefresh>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared profile pieces                                              */
/* ------------------------------------------------------------------ */

export function ProfileHeader({
  onBack,
  avatarUrl,
  onPickAvatar,
  name,
  onName,
  sub,
  accountType,
}: {
  onBack: () => void;
  avatarUrl: string | null;
  /** Rejects when the picture does not upload. */
  onPickAvatar: (file: File) => Promise<unknown>;
  name: string;
  /** Rejects when the name does not save. */
  onName: (name: string) => Promise<unknown>;
  sub: string;
  /** Which half of the marketplace this account is. */
  accountType?: AccountType | null;
}) {
  /**
   * The name is typed locally and saved once, not on every keystroke.
   *
   * It used to be a controlled input bound straight to the profile, with
   * onChange calling updateProfile — so every character was a database write
   * plus a full refetch of every screen's data, and the value the field showed
   * came back over the network. Typing eight letters meant eight round trips
   * fighting each other, which on a phone is the keyboard freezing.
   */
  const [draft, setDraft] = useState(name);
  const saved = useRef(name);
  /*
   * Both writes used to float. A name typed on a dropped connection stayed in
   * the field, looking saved, until a refresh replaced it with the old one;
   * a picture that failed to upload left the old avatar with no explanation.
   */
  const [failed, setFailed] = useState<string | null>(null);

  // Follows the profile when it changes from somewhere else, without
  // overwriting what is being typed right now.
  useEffect(() => {
    if (name !== saved.current) {
      saved.current = name;
      setDraft(name);
    }
  }, [name]);

  const commit = () => {
    const value = draft.trim();
    if (value === saved.current) return;
    const previous = saved.current;
    saved.current = value;
    setFailed(null);
    void onName(value).catch((cause) => {
      // Put the field back to what is actually stored, so what is on screen
      // and what is in the database are never two different names.
      saved.current = previous;
      setDraft(previous);
      setFailed(errorMessage(cause, "That name did not save."));
    });
  };

  return (
    <div
      className="px-6 pt-8 pb-8 relative rounded-b-[30px] overflow-hidden text-center shrink-0"
      style={{ background: "radial-gradient(130% 130% at 50% 0%, #1E4066 0%, #16304E 80%)" }}
    >
      <Ambient />
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="w-9 h-9 rounded-full flex items-center justify-center press absolute left-6 top-8 z-20"
        style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
      >
        <ArrowLeft size={16} color="#fff" />
      </button>
      {/*
        z-10 here, below the button's z-20. Both used to be z-10, and since this
        block comes later in the DOM it painted over the button — a real click
        landed on this centred column, so Back silently did nothing.
      */}
      <div className="relative z-10 pt-2 flex flex-col items-center">
        <AvatarUpload
          photoUrl={avatarUrl}
          onPick={(file) => {
            setFailed(null);
            void onPickAvatar(file).catch((cause) =>
              setFailed(errorMessage(cause, "That picture did not upload.")),
            );
          }}
        />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          placeholder="Add your name"
          aria-label="Your name"
          className="text-center font-body font-medium text-[15.5px] bg-transparent outline-none text-white mt-3 placeholder:text-white/40"
          style={{
            borderBottom: "1px solid rgba(255,255,255,0.25)",
            paddingBottom: 3,
            width: 190,
          }}
        />
        {failed && (
          <p className="font-body font-normal text-[13.5px] mt-2 text-coral-soft" role="alert">
            {failed}
          </p>
        )}
        <p className="font-body font-normal text-[13.5px] text-white/55 mt-2">{sub}</p>
        {accountType && (
          <div className="mt-2.5">
            <AccountBadge accountType={accountType} tone="dark" />
          </div>
        )}
      </div>
    </div>
  );
}

export function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] mb-2.5 text-sky-text">
      {children}
    </p>
  );
}

export function ProfileRow({
  icon: Icon,
  label,
  value,
  onClick,
  danger = false,
}: {
  icon: typeof CreditCard;
  label: string;
  value?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
}) {
  const tint = danger ? "#B45143" : "#3B9BE8";

  // A row without an action is a label, not a button — rendering it as one
  // would promise a tap that does nothing.
  if (!onClick) {
    return (
      <div
        className="w-full flex items-center gap-3 p-3.5 rounded-xl bg-white"
        style={{ border: "1px solid #E7EEF6" }}
      >
        <Icon size={15} color={tint} />
        <span className="flex-1 font-body font-medium text-[14.5px] text-navy">{label}</span>
        {value && <span className="font-body font-normal text-[13.5px] text-ink-faint">{value}</span>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3.5 rounded-xl press bg-white text-left"
      style={{ border: "1px solid #E7EEF6" }}
    >
      <Icon size={15} color={tint} />
      <span
        className="flex-1 font-body font-medium text-[14.5px]"
        style={{ color: danger ? "#B45143" : "#16304E" }}
      >
        {label}
      </span>
      {value && <span className="font-body font-normal text-[13.5px] text-ink-faint">{value}</span>}
      <ChevronRight size={14} color="#B9CBDD" />
    </button>
  );
}

export function SettingToggle({
  label,
  sub,
  on,
  onToggle,
}: {
  label: string;
  sub: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className="flex items-center justify-between p-3.5 rounded-xl bg-white"
      style={{ border: "1px solid #E7EEF6" }}
    >
      <div className="pr-3">
        <p className="font-body font-medium text-[14.5px] text-navy">{label}</p>
        <p className="font-body font-normal text-[13.5px] mt-0.5 text-ink-faint">{sub}</p>
      </div>
      <Toggle on={on} onClick={onToggle} label={label} />
    </div>
  );
}
