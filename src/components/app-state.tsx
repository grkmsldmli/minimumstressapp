"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import type { Profile } from "@/lib/domain";
import { MockRepository } from "@/lib/mock-repository";
import type { Repository } from "@/lib/repository";

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
  | "confirmed"
  | "bookings"
  | "practitioner-profile"
  | "pro"
  | "legal"
  | "host"
  | "addspace"
  | "edit-hours"
  | "earnings"
  | "host-profile";

interface AppState {
  repo: Repository & { simulateInboundBooking(spaceId: string): Promise<unknown> };
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

  /** Bumped whenever data changes, so screens can refetch without a store. */
  revision: number;
  refresh: () => void;
}

const Context = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  // Lazy useState rather than useRef: the instance must survive re-renders,
  // but reading a ref during render is exactly what React tells you not to do,
  // and this value is read on every render.
  const [repo] = useState(() => new MockRepository());

  // The stack holds the current screen at its top, so there is no second
  // source of truth to keep in step with it.
  const [history, setHistory] = useState<Screen[]>(["splash"]);
  const screen = history[history.length - 1];

  const [email, setEmail] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  const [activeBookingId, setActiveBookingId] = useState<string | null>(null);
  const [editingSpaceId, setEditingSpaceId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

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
