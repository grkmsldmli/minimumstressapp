"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Building2, ChevronRight, Mail, Sparkles, Users } from "lucide-react";

import { Ambient, BreathingLogo, Headline, Wordmark } from "@/components/brand";
import { PrimaryButton } from "@/components/primitives";
import { PROVIDER_LABELS, type Provider } from "@/lib/auth-providers";

const NAVY_WASH =
  "radial-gradient(120% 90% at 50% 0%, #1E4066 0%, #16304E 55%, #0E2138 100%)";

/** Full-bleed navy screen with the ambient starfield. */
export function NavyScreen({
  children,
  className = "",
  onBack,
}: {
  children: React.ReactNode;
  className?: string;
  /**
   * When present, a back arrow floats at the top-left over the starfield. The
   * onboarding screens sit above the shell's data guard, so this is the only
   * way back off them — without it, a wrong email typed into the code screen
   * had no way home but killing the app.
   */
  onBack?: () => void;
}) {
  return (
    <div
      className={`h-full flex flex-col screen-in relative overflow-hidden ${className}`}
      style={{ background: NAVY_WASH }}
    >
      <Ambient />
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="absolute left-5 top-5 z-20 w-9 h-9 rounded-full flex items-center justify-center press"
          style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
        >
          <ArrowLeft size={16} color="#fff" />
        </button>
      )}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Splash — the 4-7-8 cycle, narrated                                 */
/* ------------------------------------------------------------------ */

const BREATH_PHASES = [
  { label: "breathe in", ms: 4000 },
  { label: "hold", ms: 7000 },
  { label: "breathe out", ms: 8000 },
] as const;

export function Splash({ next }: { next: () => void }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const id = setTimeout(
      () => setPhase((p) => (p + 1) % BREATH_PHASES.length),
      BREATH_PHASES[phase].ms,
    );
    return () => clearTimeout(id);
  }, [phase]);

  return (
    <NavyScreen className="items-center justify-between text-center px-8 pt-14 pb-9">
      <div className="flex flex-col items-center relative z-10">
        <Wordmark size={13} />
        <div className="mt-5">
          <Headline pre="Space for your" accent="mind, body & spirit." size={28} light />
        </div>
      </div>

      <div className="flex flex-col items-center gap-6 relative z-10">
        <BreathingLogo size={160} />
        <div>
          <p
            className="font-body font-normal text-[13.5px] text-white/60 tracking-[0.12em] uppercase"
            aria-live="polite"
          >
            {BREATH_PHASES[phase].label}
          </p>
          <p className="font-body text-[12px] text-white/35 tracking-[0.3em] mt-1">4 · 7 · 8</p>
        </div>
      </div>

      <div className="w-full relative z-10">
        <p className="font-body font-normal text-[14px] leading-relaxed text-white/65 mb-6">
          Private rooms for every kind of practice — movement, coaching, meditation,
          and healing.
        </p>
        <PrimaryButton onClick={next}>Begin</PrimaryButton>
      </div>
    </NavyScreen>
  );
}

/* ------------------------------------------------------------------ */
/*  How it works                                                       */
/* ------------------------------------------------------------------ */

export function HowItWorks({ next, onBack }: { next: () => void; onBack?: () => void }) {
  return (
    <NavyScreen className="items-center justify-between px-8 pt-14 pb-9" onBack={onBack}>
      <div className="relative z-10 text-center">
        <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] text-sky-soft">
          How it works
        </p>
        <div className="mt-2">
          <Headline pre="One" accent="simple loop." size={26} light />
        </div>
      </div>

      <div className="relative z-10" style={{ width: 280, height: 280 }}>
        <svg width="280" height="280" viewBox="0 0 280 280" fill="none" className="absolute inset-0" aria-hidden="true">
          <circle
            cx="140"
            cy="140"
            r="96"
            stroke="rgba(143,198,245,0.45)"
            strokeWidth="1.5"
            strokeDasharray="4 10"
            fill="none"
            className="loop-spin"
          />
        </svg>
        <DiagramNode x={140} y={44} label="Practitioner" delay={100}>
          <Users size={20} color="#fff" />
        </DiagramNode>
        <DiagramNode x={223} y={188} label="Space" delay={220}>
          <Building2 size={20} color="#fff" />
        </DiagramNode>
        <DiagramNode x={57} y={188} label="Payout" delay={340} coral>
          <Sparkles size={20} color="#fff" />
        </DiagramNode>
      </div>

      <div className="relative z-10 w-full text-center">
        <p className="font-body font-normal text-[14px] leading-relaxed text-white/60 mb-6">
          Practitioners book the hour. Studios fill the gap.
          <br />
          Payout follows every completed session.
        </p>
        <PrimaryButton onClick={next}>Find a space</PrimaryButton>
      </div>
    </NavyScreen>
  );
}

function DiagramNode({
  x,
  y,
  label,
  children,
  coral = false,
  delay = 0,
}: {
  x: number;
  y: number;
  label: string;
  children: React.ReactNode;
  coral?: boolean;
  delay?: number;
}) {
  const SIZE = 58;
  return (
    <div
      className="absolute flex flex-col items-center node-pop"
      style={{ left: x - SIZE / 2 - 20, top: y - SIZE / 2, width: SIZE + 40, animationDelay: `${delay}ms` }}
    >
      <div
        className="rounded-full flex items-center justify-center"
        style={{
          width: SIZE,
          height: SIZE,
          background: coral
            ? "linear-gradient(135deg, #F2695C, #B03A2E)"
            : "linear-gradient(135deg, #3B9BE8, #1E4066)",
          boxShadow: coral
            ? "0 8px 24px -6px rgba(242,105,92,0.5)"
            : "0 8px 24px -6px rgba(59,155,232,0.5)",
          border: "1px solid rgba(255,255,255,0.25)",
        }}
      >
        {children}
      </div>
      <p className="font-body font-medium text-[15px] text-white mt-2">{label}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Auth                                                               */
/* ------------------------------------------------------------------ */

/** "Apple, Google or Microsoft" — an Oxford-less list of what is switched on. */
function listProviders(providers: Provider[]): string {
  const names = providers.map((provider) => PROVIDER_LABELS[provider]);
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/** The four squares, in Microsoft's own colours. Flat by design, like theirs. */
function MicrosoftGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 23 23" aria-hidden="true">
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M12 1h10v10H12z" />
      <path fill="#00A4EF" d="M1 12h10v10H1z" />
      <path fill="#FFB900" d="M12 12h10v10H12z" />
    </svg>
  );
}

function AppleGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 384 512" fill="currentColor" aria-hidden="true">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}

function GoogleGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34 5.1 29.3 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.6 19 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34 5.1 29.3 3 24 3c-7.7 0-14.3 4.4-17.7 10.7z" />
      <path fill="#4CAF50" d="M24 45c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 36.3 26.7 37 24 37c-5.3 0-9.7-3.4-11.3-8.1l-6.5 5C9.6 40.5 16.2 45 24 45z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.2 5.2C40.9 36.4 44 30.9 44 24c0-1.2-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function AuthEntry({
  onEmail,
  onProvider,
  providers,
  error,
  busy = false,
  onBack,
}: {
  onEmail: (email: string) => void;
  onProvider: (provider: Provider) => void;
  /**
   * The ways in that actually work, read from the auth server rather than
   * assumed. Both buttons used to render unconditionally and both failed,
   * because neither provider was enabled on the project.
   */
  providers: Provider[];
  /** Why the code could not be sent. Shown here because there is no code screen to show it on. */
  error?: string | null;
  busy?: boolean;
  onBack?: () => void;
}) {
  const [email, setEmail] = useState("");
  // A trailing-dot or spaceless check catches the common typo without
  // pretending to validate deliverability, which only the OTP can do.
  const looksLikeEmail = /^\S+@\S+\.\S+$/.test(email.trim());

  return (
    <NavyScreen className="justify-center gap-10 px-8 pt-16 pb-9" onBack={onBack}>
      <div className="relative z-10 text-center">
        <div className="flex justify-center">
          <Wordmark size={13} />
        </div>
        <div className="mt-6">
          <Headline pre="Let's get" accent="you in." size={27} light />
        </div>
        {/*
          Named from what is actually enabled, not from a sentence typed once.
          It read "One tap with Apple or Google" while only Google was on, so
          the screen promised a button that was not there — the exact failure
          auth-providers.ts exists to prevent, reintroduced one line below the
          fix.
        */}
        <p className="font-body font-normal text-[14px] text-white/60 mt-3 leading-relaxed">
          {providers.length > 0
            ? `One tap with ${listProviders(providers)} — or use email below.`
            : "We'll email you a six-digit code. No password to remember."}
        </p>
      </div>

      <div className="relative z-10">
        {providers.length > 0 && (
          <div className="flex flex-col gap-2.5">
            {providers.includes("apple") && (
              <button
                type="button"
                onClick={() => onProvider("apple")}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full font-body font-medium text-[15px] press"
                style={{ backgroundColor: "#fff", color: "#000" }}
              >
                <AppleGlyph /> Continue with Apple
              </button>
            )}
            {providers.includes("google") && (
              <button
                type="button"
                onClick={() => onProvider("google")}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full font-body font-medium text-[15px] press text-navy"
                style={{ backgroundColor: "#fff", border: "1px solid #E1E6EC" }}
              >
                <GoogleGlyph /> Continue with Google
              </button>
            )}
            {providers.includes("azure") && (
              <button
                type="button"
                onClick={() => onProvider("azure")}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full font-body font-medium text-[15px] press text-navy"
                style={{ backgroundColor: "#fff", border: "1px solid #E1E6EC" }}
              >
                <MicrosoftGlyph /> Continue with Microsoft
              </button>
            )}
          </div>
        )}

        <div
          className="flex items-center gap-3 my-5"
          style={{ display: providers.length > 0 ? undefined : "none" }}
        >
          <div className="flex-1 h-px" style={{ backgroundColor: "rgba(255,255,255,0.16)" }} />
          <span className="font-body font-normal text-[12px] text-white/40 uppercase tracking-wide">
            or with email
          </span>
          <div className="flex-1 h-px" style={{ backgroundColor: "rgba(255,255,255,0.16)" }} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (looksLikeEmail && !busy) onEmail(email.trim());
          }}
        >
          <div
            className="flex items-center gap-2.5 px-4 py-3.5 rounded-2xl"
            style={{
              backgroundColor: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.16)",
            }}
          >
            <Mail size={15} color="#8FC6F5" />
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              aria-label="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              className="font-body text-[15px] outline-none w-full bg-transparent text-white placeholder:text-white/40"
            />
          </div>
          {error && (
            <p className="font-body font-normal text-[14px] mt-2.5 leading-relaxed text-coral-soft">
              {error}
            </p>
          )}
          <div className="mt-3">
            <PrimaryButton type="submit" disabled={!looksLikeEmail || busy}>
              {busy ? "Sending…" : "Send code"}
            </PrimaryButton>
          </div>
        </form>
      </div>
    </NavyScreen>
  );
}

/**
 * Six, not the prototype's four. Supabase sends a six-digit code, so a
 * four-box input physically cannot hold a valid one — every sign-in would have
 * failed with a correct code typed in.
 */
const CODE_LENGTH = 6;

export function AuthVerify({
  email,
  next,
  error,
  busy = false,
  onBack,
}: {
  email: string;
  next: (code: string) => void;
  error?: string | null;
  busy?: boolean;
  onBack?: () => void;
}) {
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const complete = digits.every((d) => d !== "");

  const setDigit = (index: number, value: string) => {
    // Handles paste of a whole code as well as single keystrokes; the
    // prototype dropped everything but the first character either way.
    const cleaned = value.replace(/\D/g, "");
    if (!cleaned) {
      setDigits((d) => d.map((v, i) => (i === index ? "" : v)));
      return;
    }

    setDigits((d) => {
      const next = [...d];
      for (let i = 0; i < cleaned.length && index + i < CODE_LENGTH; i += 1) {
        next[index + i] = cleaned[i];
      }
      return next;
    });

    const landed = Math.min(index + cleaned.length, CODE_LENGTH - 1);
    inputs.current[landed]?.focus();
  };

  const onKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

  return (
    /*
      Centred, not spread.
      
      This screen borrowed `justify-between` from the one before it, where a
      heading at the top and buttons at the bottom are both real content. Here
      there is a heading and six boxes, and holding them apart left a third of
      the screen empty with the input stranded at the bottom edge — which reads
      as a rendering failure rather than a layout.
    */
    <NavyScreen className="justify-center px-8 py-16" onBack={onBack}>
      <div className="relative z-10 text-center">
        <div className="flex justify-center">
          <Wordmark size={13} />
        </div>
        <div className="mt-6">
          <Headline pre="Enter the" accent="code." size={27} light />
        </div>
        <p className="font-body font-normal text-[14px] text-white/60 mt-3 leading-relaxed">
          Sent to {email}
        </p>
      </div>

      {/* Close to the heading it belongs to, rather than a screen away. */}
      <div className="relative z-10 mt-10">
        <div className="flex justify-center gap-2">
          {digits.map((digit, i) => (
            <input
              key={i}
              ref={(el) => {
                inputs.current[i] = el;
              }}
              value={digit}
              inputMode="numeric"
              autoComplete={i === 0 ? "one-time-code" : "off"}
              aria-label={`Digit ${i + 1} of ${CODE_LENGTH}`}
              onChange={(e) => setDigit(i, e.target.value)}
              onKeyDown={(e) => onKeyDown(i, e)}
              className="text-center font-display italic text-[20px] rounded-xl outline-none text-white"
              style={{
                width: 44,
                height: 56,
                backgroundColor: "rgba(255,255,255,0.1)",
                border: `1px solid ${
                  error ? "#F2695C" : digit ? "#3B9BE8" : "rgba(255,255,255,0.2)"
                }`,
              }}
            />
          ))}
        </div>

        {error && (
          <p className="font-body font-normal text-[14px] text-center mt-3 text-coral-soft">
            {error}
          </p>
        )}

        <div className="mt-6">
          <PrimaryButton disabled={!complete || busy} onClick={() => next(digits.join(""))}>
            {busy ? "Checking…" : "Continue"}
          </PrimaryButton>
        </div>
      </div>
    </NavyScreen>
  );
}

/* ------------------------------------------------------------------ */
/*  Role select                                                        */
/* ------------------------------------------------------------------ */

/**
 * The one choice on this screen cannot be undone, so it is made twice.
 *
 * Tapping a card selects it; a second, explicit confirm commits it. That is
 * more friction than a normal choice deserves and exactly right for this one —
 * an account is one side of the marketplace, the two have different paperwork,
 * fees and payouts, and getting it wrong means starting again with a different
 * email. The warning is shown before the commit, not as a footnote after it.
 */
export function RoleSelect({
  choosePractitioner,
  chooseHost,
  error,
}: {
  choosePractitioner: () => void;
  chooseHost: () => void;
  /** Why the choice was refused. Silence here was the bug. */
  error?: string | null;
}) {
  const [pending, setPending] = useState<"practitioner" | "host" | null>(null);

  if (pending) {
    const isPractitioner = pending === "practitioner";
    return (
      <NavyScreen className="items-center justify-between text-center px-8 pt-16 pb-9">
        <div className="relative z-10">
          <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] text-coral-soft">
            Before you continue
          </p>
          <div className="mt-2">
            <Headline
              pre="This can't be"
              accent="changed later."
              size={26}
              light
            />
          </div>
        </div>

        <div className="relative z-10 w-full">
          <div
            className="rounded-2xl p-5 text-left"
            style={{
              backgroundColor: "rgba(255,255,255,0.07)",
              border: "1px solid rgba(255,255,255,0.14)",
            }}
          >
            <div className="flex items-center gap-2.5">
              {isPractitioner ? (
                <Users color="#8FC6F5" size={18} />
              ) : (
                <Building2 color="#F2A79E" size={18} />
              )}
              <p className="font-body font-medium text-[15.5px] text-white">
                {isPractitioner ? "I teach or practice" : "I have a space"}
              </p>
            </div>

            <p className="font-body font-normal text-[13.5px] text-white/70 mt-3 leading-relaxed">
              {isPractitioner
                ? "Find and book rooms on your schedule, with your insurance and your booking history in one place."
                : "List your space, set your hours, and get paid — with your lease, your payouts and your calendar in one place."}
            </p>

          </div>

          {error && (
            <p className="font-body font-normal text-[13.5px] leading-relaxed mt-4 text-coral-soft">
              {error}
            </p>
          )}

          <div className="flex gap-2.5 mt-4">
            <button
              type="button"
              onClick={() => setPending(null)}
              className="flex-1 py-3.5 rounded-full font-body font-medium text-[14.5px] press text-white"
              style={{ border: "1px solid rgba(255,255,255,0.22)" }}
            >
              Go back
            </button>
            <button
              type="button"
              onClick={isPractitioner ? choosePractitioner : chooseHost}
              className="flex-1 py-3.5 rounded-full font-body font-medium text-[14.5px] text-white press"
              style={{ backgroundColor: isPractitioner ? "#3B9BE8" : "#F2695C" }}
            >
              Yes, continue
            </button>
          </div>
        </div>

        <div />
      </NavyScreen>
    );
  }

  return (
    <NavyScreen className="items-center justify-between text-center px-8 pt-16 pb-9">
      <div className="relative z-10">
        <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] text-sky-soft">
          One quick thing
        </p>
        <div className="mt-2">
          <Headline pre="Which brings you" accent="here?" size={27} light />
        </div>
      </div>

      <div className="relative z-10 w-full flex flex-col gap-3.5">
        <button
          type="button"
          onClick={() => setPending("practitioner")}
          className="text-left rounded-2xl p-5 press"
          style={{ backgroundColor: "#2578C2" }}
        >
          <Users color="#fff" size={20} />
          <p className="font-body font-medium text-[16.5px] text-white mt-3">I teach or practice</p>
          <p className="font-body font-normal text-[13.5px] text-white/80 mt-1">
            Find a private room for the time you need — no membership, one all-in price.
          </p>
          <span className="inline-flex items-center gap-1 font-body text-[15px] font-medium text-white mt-3">
            Browse spaces <ChevronRight size={14} />
          </span>
        </button>

        <button
          type="button"
          onClick={() => setPending("host")}
          className="text-left rounded-2xl p-5 press"
          style={{ backgroundColor: "#F2695C" }}
        >
          <Building2 color="#fff" size={20} />
          <p className="font-body font-medium text-[16.5px] text-white mt-3">I have a space</p>
          <p className="font-body font-normal text-[13.5px] text-white/80 mt-1">
            List your open hours and get paid when they&apos;re booked.
          </p>
          <span className="inline-flex items-center gap-1 font-body text-[15px] font-medium text-white mt-3">
            Set up hosting <ChevronRight size={14} />
          </span>
        </button>
      </div>

      {/*
        No promise of switching. The account type is write-once, refused by a
        trigger in the database — telling somebody they can add the other side
        later was the app offering something it goes on to refuse, and the
        person finds out at the moment they need it.
      */}
      <p className="relative z-10 font-body font-normal text-[13.5px] text-white/45 pt-7 leading-relaxed">
        Each side has its own account, with its own paperwork and payments. This choice is
        permanent.
      </p>
    </NavyScreen>
  );
}

