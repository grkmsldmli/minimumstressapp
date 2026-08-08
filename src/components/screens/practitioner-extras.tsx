"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Clock,
  CreditCard,
  FileUp,
  LogOut,
  Percent,
  ScrollText,
  Zap,
} from "lucide-react";

import { AccountBadge } from "@/components/account-badge";
import { DeleteAccount } from "@/components/delete-account";
import { EmergencyContactCard } from "@/components/emergency-contact";
import { BadgeCard } from "@/components/badge-card";
import { Ambient, BreathingLogo, Headline } from "@/components/brand";
import { ConfettiBurst, PrimaryButton, Toggle } from "@/components/primitives";
import { StandingNotice } from "@/components/standing-notice";
import { AvatarUpload, DocumentUpload } from "@/components/uploads";
import type { AccountType, Profile } from "@/lib/domain";
import type { Standing } from "@/lib/reliability";
import { INSTANT_FEE_CENTS, PRO_HORIZON_DAYS, PRO_PRICE_CENTS, formatCents } from "@/lib/money";

import { NavyScreen } from "./shared";

/* ------------------------------------------------------------------ */
/*  Insurance upload — optional, never blocks a booking                */
/* ------------------------------------------------------------------ */

export function InsuranceUpload({
  onContinue,
  onBack,
  initialDocName,
}: {
  onContinue: (docName: string | null) => void;
  onBack?: () => void;
  initialDocName: string | null;
}) {
  const [file, setFile] = useState<File | null>(null);
  const existingName = file?.name ?? initialDocName;

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
          Optional, takes 10 seconds
        </p>
        <div className="mt-2">
          <Headline pre="Add your" accent="insurance?" size={27} light />
        </div>
        {/*
          The old line said "hosts approve you faster when a certificate is
          already on file". There is no host approval of practitioners — a
          booking is direct — and a host never sees this document. It described
          a mechanism that does not exist.
        */}
        <p className="font-body font-normal text-[14px] leading-relaxed text-white/65 mt-3">
          Many venues require practitioners to carry their own cover. Keeping a certificate here
          means you have it to hand. You can add it later from your profile, and it never blocks a
          booking.
        </p>

        <div className="mt-6 rounded-2xl p-4 bg-white">
          <DocumentUpload
            label="Certificate of insurance"
            hint="PDF or photo"
            file={file}
            onPick={setFile}
            onRemove={() => setFile(null)}
          />
          {!file && initialDocName && (
            <p className="font-body font-normal text-[13.5px] mt-2 text-ink-faint">
              On file: {initialDocName}
            </p>
          )}
        </div>

        {/*
          The brief flags the current Thimble link as an untracked placeholder
          and asks for the real referral code, so this stays a plain outbound
          link rather than pretending to be an affiliate one.
        */}
        <a
          href="https://www.thimble.com"
          target="_blank"
          rel="noopener noreferrer"
          className="font-body text-[14px] mt-3 text-sky-soft"
        >
          Don&apos;t have coverage yet? Get a quote →
        </a>
      </div>

      <div className="relative z-10 px-8 pb-9">
        <PrimaryButton onClick={() => onContinue(existingName)}>
          {existingName ? "Continue" : "Skip for now"}
        </PrimaryButton>
      </div>
    </NavyScreen>
  );
}

/* ------------------------------------------------------------------ */
/*  Pro                                                                */
/* ------------------------------------------------------------------ */

const PERKS = [
  {
    icon: Zap,
    title: "Skip every instant fee",
    sub: `Book last-minute slots free — save ${formatCents(INSTANT_FEE_CENTS)} each time`,
  },
  {
    icon: Clock,
    title: "Priority booking window",
    sub: `Reserve open hours up to ${PRO_HORIZON_DAYS} days out, instead of same-day only`,
  },
  {
    icon: Percent,
    title: "10% off every room",
    sub: "Applied automatically to the all-in price, every category, every booking",
  },
] as const;

export function ProScreen({
  isPro,
  onBack,
  onSubscribe,
}: {
  isPro: boolean;
  onBack: () => void;
  onSubscribe: () => void;
}) {
  const [justSubscribed, setJustSubscribed] = useState(false);

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
            Instant fees are waived, your 10% discount is live, and you can book up to{" "}
            {PRO_HORIZON_DAYS} days ahead.
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
        <div className="flex flex-col gap-2.5">
          {PERKS.map(({ icon: Icon, title, sub }, i) => (
            <div
              key={title}
              className="flex items-start gap-3 p-3.5 rounded-2xl card-in"
              style={{
                backgroundColor: "#F4F8FC",
                border: "1px solid #E7EEF6",
                animationDelay: `${i * 90}ms`,
              }}
            >
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                style={{ background: "linear-gradient(135deg, #3B9BE8, #16304E)" }}
              >
                <Icon size={15} color="#fff" />
              </div>
              <div>
                <p className="font-body font-medium text-[14.5px] text-navy">{title}</p>
                <p className="font-body font-normal text-[14px] mt-0.5 text-ink-soft">{sub}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="px-6 pb-7 shrink-0">
        <PrimaryButton
          onClick={() => {
            onSubscribe();
            setJustSubscribed(true);
          }}
        >
          Start Pro — {formatCents(PRO_PRICE_CENTS)}/mo
        </PrimaryButton>
        <p className="text-center font-body font-normal text-[13.5px] mt-2.5 text-ink-faint">
          Cancel anytime. For practitioners only — hosting stays commission-based.
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
  bookingsCount,
  standing,
  onBack,
  onUpdate,
  sessions,
  onDeleteAccount,
  onPickAvatar,
  onGoLegal,
  onGoInsurance,
  onSignOut,
}: {
  profile: Profile;
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

      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-8">
        {/*
          Shown always, not only when something is wrong. A rule nobody can see
          until it costs them is a trap; this way "where do I stand" is a tap
          away on a good day too.
        */}
        <div className="mb-6">
          <StandingNotice party="practitioner" standing={standing} />
        </div>

        <GroupLabel>Notifications</GroupLabel>
        <div className="flex flex-col gap-2.5">
          <SettingToggle
            label="Booking reminders"
            sub="Entry code and session reminders"
            on={profile.notifyBookings}
            onToggle={() => onUpdate({ notifyBookings: !profile.notifyBookings })}
          />
          <SettingToggle
            label="Offers"
            sub="Pro deals and occasional updates"
            on={profile.notifyOffers}
            onToggle={() => onUpdate({ notifyOffers: !profile.notifyOffers })}
          />
        </div>

        <div className="mt-6">
          <GroupLabel>Account</GroupLabel>
        </div>
        <div className="flex flex-col gap-2.5">
          {/*
            No stored card to manage yet. Stripe's embedded element collects it
            at checkout, so this states where it happens instead of offering a
            settings screen that has nothing in it.
          */}
          <ProfileRow icon={CreditCard} label="Payment method" value="Entered at checkout" />
          <ProfileRow
            icon={FileUp}
            label="Insurance certificate"
            value={profile.insuranceDocName ?? "Not added"}
            onClick={onGoInsurance}
          />
          <ProfileRow icon={ScrollText} label="Terms & privacy" onClick={onGoLegal} />
          <ProfileRow icon={LogOut} label="Log out" onClick={onSignOut} danger />
        </div>

        <div className="mt-6">
          <BadgeCard party="practitioner" sessions={sessions} />
        </div>

        {/*
          Asked of both sides. Somebody alone in a stranger's building and
          somebody letting a stranger into theirs are in the same position.
        */}
        <div className="mt-6">
          <EmergencyContactCard
            contact={profile.emergencyContact}
            onSave={(emergencyContact) => onUpdate({ emergencyContact })}
          />
        </div>

        {/* Last, and on its own. Nothing here is undoable except this. */}
        <div className="mt-8">
          <DeleteAccount onDelete={onDeleteAccount} />
        </div>
      </div>
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
  onPickAvatar: (file: File) => void;
  name: string;
  onName: (name: string) => void;
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
    saved.current = value;
    onName(value);
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
        <AvatarUpload photoUrl={avatarUrl} onPick={onPickAvatar} />
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
