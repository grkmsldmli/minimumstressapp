"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { Profile } from "@/lib/domain";
import { type AppRepository, createRepository, supabaseBackendEnabled } from "@/lib/repository-factory";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Every screen in the flow, as one state machine.
 *
 * The prototype drove this with a `screen` string and a pile of sibling
 * useStates in the root component, which is why "which screen comes after
 * Role Select" was answered in three different places. Routing lives here
 * instead, so a rule like "a host with no spaces skips the empty dashboard"
 * is written once.
 */
export type Screen =
  | "splash"
  | "how"
  | "auth-entry"
  | "auth-verify"
  | "role"
  | "verify"
  | "discover"
  | "detail"
  | "payment"
  | "confirmed"
  | "bookings"
  | "review"
  | "thread"
  | "practitioner-profile"
  | "pro"
  | "legal"
  | "host"
  | "addspace"
  | "edit-hours"
  | "earnings"
  | "host-profile";

interface AppState {
  repo: AppRepository;
  screen: Screen;
  go: (screen: Screen) => void;
  back: () => void;
  /** Clears the session and returns to splash. */
  reset: () => void;

  email: string;
  setEmail: (email: string) => void;

  profile: Profile | null;
  setProfile: (profile: Profile) => void;

  /** Which space Detail is showing, and which booking Confirmed is showing. */
  activeSpaceId: string | null;
  setActiveSpaceId: (id: string | null) => void;
  activeBookingId: string | null;
  setActiveBookingId: (id: string | null) => void;
  editingSpaceId: string | null;
  setEditingSpaceId: (id: string | null) => void;

  /**
   * The PaymentIntent the card sheet is confirming.
   *
   * Held here rather than fetched by the sheet, because it is minted once by
   * the booking route and asking again would create a second intent for the
   * same booking. Cleared on the way out so a stale secret can never be
   * handed to a later, unrelated booking.
   */
  clientSecret: string | null;
  setClientSecret: (secret: string | null) => void;

  /** Which booking the review screen is about, and from which side. */
  reviewing: { bookingId: string; role: "practitioner" | "host" } | null;
  setReviewing: (target: { bookingId: string; role: "practitioner" | "host" } | null) => void;

  /** Which booking's thread is open. */
  threadBookingId: string | null;
  setThreadBookingId: (id: string | null) => void;

  /** Bumped whenever data changes, so screens can refetch without a store. */
  revision: number;
  refresh: () => void;
}

const Context = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  // Lazy useState rather than useRef: the instance must survive re-renders,
  // but reading a ref during render is exactly what React tells you not to do,
  // and this value is read on every render.
  const [repo] = useState(createRepository);

  // The stack holds the current screen at its top, so there is no second
  // source of truth to keep in step with it.
  const [history, setHistory] = useState<Screen[]>(["splash"]);
  const screen = history[history.length - 1];

  const [email, setEmail] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  const [activeBookingId, setActiveBookingId] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<{
    bookingId: string;
    role: "practitioner" | "host";
  } | null>(null);
  const [threadBookingId, setThreadBookingId] = useState<string | null>(null);
  const [editingSpaceId, setEditingSpaceId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  /**
   * Someone already signed in should not be asked to sign in.
   *
   * The shell always started at splash and walked forward, so a returning
   * visitor was sent an email code for an account they were already holding a
   * valid token for. The session lives in the browser and outlives the tab, so
   * the only honest first question is whether there is one.
   *
   * Only from splash: this must never yank someone out of a screen they
   * navigated to themselves, and by the time any other screen is showing, the
   * question has already been answered.
   */
  useEffect(() => {
    if (!supabaseBackendEnabled()) return;

    let cancelled = false;
    void (async () => {
      const { data } = await supabaseBrowser().auth.getSession();
      if (cancelled || !data.session) return;
      setHistory((h) => (h.length === 1 && h[0] === "splash" ? ["discover"] : h));
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const go = useCallback((next: Screen) => {
    setHistory((h) => [...h, next]);
  }, []);

  // Never pops the last entry, so there is always a screen to render.
  const back = useCallback(() => {
    setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h));
  }, []);

  /**
   * Returns to the splash screen and drops the navigation history, so Back
   * cannot walk someone straight back into a signed-in screen after they have
   * logged out.
   */
  const reset = useCallback(() => {
    setHistory(["splash"]);
    setEmail("");
    setActiveSpaceId(null);
    setActiveBookingId(null);
    setEditingSpaceId(null);
    setClientSecret(null);
    setReviewing(null);
    setThreadBookingId(null);
  }, []);

  const refresh = useCallback(() => setRevision((r) => r + 1), []);

  const value = useMemo<AppState>(
    () => ({
      repo,
      screen,
      go,
      back,
      reset,
      email,
      setEmail,
      profile,
      setProfile,
      activeSpaceId,
      setActiveSpaceId,
      activeBookingId,
      setActiveBookingId,
      editingSpaceId,
      setEditingSpaceId,
      clientSecret,
      setClientSecret,
      reviewing,
      setReviewing,
      threadBookingId,
      setThreadBookingId,
      revision,
      refresh,
    }),
    [
      repo,
      screen,
      go,
      back,
      reset,
      email,
      profile,
      activeSpaceId,
      activeBookingId,
      editingSpaceId,
      clientSecret,
      reviewing,
      threadBookingId,
      revision,
      refresh,
    ],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useApp(): AppState {
  const value = useContext(Context);
  if (!value) throw new Error("useApp must be used inside AppStateProvider");
  return value;
}
