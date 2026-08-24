"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Bell,
  Check,
  ChevronRight,
  CreditCard,
  FileCheck,
  FileUp,
  LogOut,
  Scale,
  ScrollText,
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
import { AvatarUpload, DocumentUpload } from "@/components/uploads";
import type { AccountType, Profile } from "@/lib/domain";
import { type InsuranceStatus, insuranceStatus } from "@/lib/insurance";
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

/* ------------------------------------------------------------------ */
/*  Insurance upload — optional at onboarding, required before booking  */
/* ------------------------------------------------------------------ */

export function InsuranceUpload({
  onContinue,
  onBack,
  initialDocName,
  status = "not_added",
  reviewNote,
}: {
  /** Rejects when the record does not save, so this screen does not move on. */
  onContinue: (docName: string | null) => Promise<unknown>;
  onBack?: () => void;
  initialDocName: string | null;
  /** Where the cover stands, so the screen can say more than "on file". */
  status?: InsuranceStatus;
  /** Staff's reason when a certificate was turned down, shown verbatim. */
  reviewNote?: string | null;
}) {
  const [file, setFile] = useState<File | null>(null);
  const existingName = file?.name ?? initialDocName;
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

  const submit = (docName: string | null) => {
    setSaveError(null);
    setSaving(true);
    void onContinue(docName)
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

        <PrimaryButton disabled={saving || !existingName} onClick={() => submit(existingName)}>
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

export function ProScreen({
  isPro,
  onBack,
  onSubscribe,
}: {
  isPro: boolean;
  onBack: () => void;
  /** Rejects when the subscription does not go through, so this screen can say so. */
  onSubscribe: () => Promise<unknown>;
}) {
  const [justSubscribed, setJustSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  /*
   * The button used to fire the subscription and show the success screen in
   * the same breath, without waiting for either answer. So a card that was
   * declined, or a network that dropped, still produced "You're Pro." —
   * somebody was told they had bought something they had not, on the one
   * screen in the app where that is a payment.
   */
  const [failed, setFailed] = useState<string | null>(null);

  if (justSubscribed || isPro) {
    return (
      <NavyScreen className="items-center justify-center text-center px-9">
        <ConfettiBurst />
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
            setFailed(null);
            setBusy(true);
            void onSubscribe()
              .then(() => setJustSubscribed(true))
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
        <div className="flex flex-col gap-2.5">
          <ProfileRow
            icon={FileUp}
            label="Liability insurance"
            // The status, not the filename: what a professional needs to know
            // here is whether they can book, and a file on record that is still
            // in review or has lapsed cannot. Derived from the stored review
            // state and the clock — see lib/insurance.ts.
            value={
              INSURANCE_LABEL[
                insuranceStatus(
                  {
                    hasCertificate: profile.insuranceDocName !== null,
                    state: profile.insuranceReview.state,
                    effectiveDate: profile.insuranceEffectiveDate,
                    expiresAt: profile.insuranceExpiresAt,
                  },
                  new Date(),
                )
              ]
            }
            onClick={onGoInsurance}
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
  value?: string;
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
