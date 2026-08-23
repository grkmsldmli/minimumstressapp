"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  Booking,
  BookingRequest,
  HostBooking,
  HostSpace,
  Profile,
  PublicSpace,
  OpenDispute,
  PublicReview,
  SpaceAccessDetails,
} from "@/lib/domain";
import { errorMessage } from "@/lib/error-message";
import { delayFor, isTransient } from "@/lib/transient";
import { hostFactsFrom, practitionerFactsFrom } from "@/lib/milestone-facts";
import {
  celebrationDue,
  earnedByHost,
  earnedByPractitioner,
  hostTotal,
  practitionerTotal,
  type MilestoneKey,
} from "@/lib/milestones";
import { MilestoneMoment } from "@/components/milestone-moment";
import { PawLoader } from "@/components/paw-loader";
import { type CancellationEvent, standingFor } from "@/lib/reliability";
import type { LocationChoice } from "@/components/location-prompt";
import { supabaseBackendEnabled } from "@/lib/repository-factory";
import {
  ensureProfile,
  sendEmailCode,
  signInWithProvider,
  verifyEmailCode,
} from "@/lib/supabase/auth";

import { type Provider, enabledProviders } from "@/lib/auth-providers";
import { isNativeApp } from "@/lib/native";
import { BOOKING_HORIZON_DAYS } from "@/lib/money";
import { SESSION_MS } from "@/lib/session";
import { explainRejection } from "@/lib/booking-plan";
import {
  checkInsuranceForBooking,
  insuranceStatus,
  type InsuranceFacts,
  type InsuranceRejection,
} from "@/lib/insurance";
import type { NotificationEntry } from "@/lib/notify/history";
import { ClaimForm } from "@/components/screens/claim-form";
import { Disputes } from "@/components/screens/disputes";
import { RefundRequest } from "@/components/screens/refund-request";
import { rebookable } from "@/lib/rebook";
import { FALLBACK_ZONE } from "@/lib/timezone";
import { sessionDayShort } from "@/lib/when";
import { TERMS_VERSION, hasAcceptedTerms } from "@/lib/terms";
import { HOST_TERMS_VERSION, hasAcceptedHostTerms } from "@/lib/host-terms";

import { type Screen, useApp } from "./app-state";
import { AcceptTerms } from "./screens/accept-terms";
import { AddSpace } from "./screens/add-space";
import { Confirmed, MyBookings } from "./screens/bookings";
import { Discover } from "./screens/discover";
import { EditSpace } from "./screens/edit-space";
import { EditAvailability, Earnings, HostDashboard, HostProfile } from "./screens/host";
import { HostSpaces } from "./screens/host-spaces";
import { Legal } from "./screens/legal";
import { Notifications } from "./screens/notifications";
import { PaymentSheet } from "./screens/payment-sheet";
import { ReviewScreen } from "./screens/review";
import { Thread, type ThreadMessage } from "./screens/thread";
import {
  InsuranceUpload,
  PractitionerProfile,
  ProScreen,
} from "./screens/practitioner-extras";
import { AuthEntry, AuthVerify, HowItWorks, RoleSelect, Splash } from "./screens/shared";
import { SpaceDetail } from "./screens/space-detail";

/**
 * Whether this account can confirm a booking on these dates, decided on the
 * client before any payment.
 *
 * The same rules planBooking enforces on the server, run early: the server is
 * still the gate that cannot be bypassed, and this only spares a wasted round
 * trip and lets the refusal carry a way to fix it rather than a dead end. Every
 * occurrence of a run is checked, because cover that is good today need not
 * reach the eighth week — and a run whose early weeks are covered but whose
 * later ones are not is told about the schedule rather than a single date.
 *
 * Returns the message to show plus the reason behind it, or null when the
 * booking may proceed. The reason lets the gate's CTA speak to the actual state
 * — add cover that is missing, view cover under review, update cover that was
 * turned down, lapsed, or short of the date.
 */
type BookingGate = {
  message: string;
  reason: InsuranceRejection | "professional_profile_required";
};

function bookingEligibilityMessage(
  profile: Profile,
  dates: readonly Date[],
  now: Date,
): BookingGate | null {
  if (profile.accountType !== "practitioner") {
    return {
      message: explainRejection("professional_profile_required").message,
      reason: "professional_profile_required",
    };
  }

  const facts: InsuranceFacts = {
    hasCertificate: profile.insuranceDocName !== null,
    state: profile.insuranceReview.state,
    effectiveDate: profile.insuranceEffectiveDate,
    expiresAt: profile.insuranceExpiresAt,
  };

  let sawCovered = false;
  for (const date of dates) {
    // The whole session, matching the server: cover must hold from the start to
    // the end, not merely on the day it begins.
    const problem = checkInsuranceForBooking(facts, date, new Date(date.getTime() + SESSION_MS), now);
    if (!problem) {
      sawCovered = true;
      continue;
    }
    if (problem === "insurance_not_valid_for_date" && sawCovered) {
      return {
        message:
          "Your current coverage expires before the end of this recurring schedule. Extend it, or book a shorter run.",
        reason: "insurance_not_valid_for_date",
      };
    }
    return { message: explainRejection(problem).message, reason: problem };
  }

  return null;
}

/** Everything the shell reads, refetched whenever the repository changes. */
interface Snapshot {
  profile: Profile;
  spaces: PublicSpace[];
  bookings: Booking[];
  mySpaces: HostSpace[];
  hostBookings: HostBooking[];
  /** What is waiting on the host to answer. Empty for everybody else. */
  bookingRequests: BookingRequest[];
  access: Record<string, SpaceAccessDetails>;
  cancellations: CancellationEvent[];
  sessions: number;
  notifications: NotificationEntry[];
}

export function App() {
  const {
    repo,
    screen,
    go,
    back,
    reset,
    email,
    setEmail,
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
    refundBookingId,
    setRefundBookingId,
    claimBookingId,
    setClaimBookingId,
    setThreadBookingId,
    revision,
    refresh,
  } = useApp();

  const [data, setData] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [bookingError, setBookingError] = useState<string | null>(null);
  /**
   * Set when a booking is refused for eligibility — no professional profile, or
   * cover that is missing, pending, expired or short of the date. Kept apart
   * from bookingError because it is not "try again": it is answered by adding
   * insurance, so the detail screen renders it with a way there rather than a
   * bare red line.
   */
  const [insuranceGate, setInsuranceGate] = useState<BookingGate | null>(null);
  /** Milestones dismissed this session, whether or not the server took it. */
  const [dismissedMilestones, setDismissedMilestones] = useState<MilestoneKey[]>([]);
  /** What a term booking did, including the weeks it could not take. */
  const [bookingNotice, setBookingNotice] = useState<string | null>(null);
  const [seriesSkipped, setSeriesSkipped] = useState<{ startsAt: string; because: string }[]>([]);

  const [authBusy, setAuthBusy] = useState(false);

  /**
   * Loaded when a thread opens rather than with everything else.
   *
   * A booking list can be long and most of its threads are empty; fetching
   * them all on every refresh would be work nobody asked for. The trade is one
   * request when a thread is actually opened.
   */
  const [thread, setThread] = useState<ThreadMessage[]>([]);

  /**
   * What people wrote about the room being looked at.
   *
   * Loaded when a listing is opened rather than with the catalogue: fifty
   * reviews for every space on Discover is a payload nobody reads, and this is
   * a question that only matters once somebody is deciding on one room.
   *
   * Null while it is in flight, so the section stays absent rather than
   * flashing "New" and then filling in.
   */
  /**
   * Refund requests and studio claims involving this account.
   *
   * Loaded with the rest of the session data rather than on demand: the badge
   * on the nav has to know whether anything is waiting before somebody opens
   * the screen, and a person who is being asked something should not have to
   * go looking for it.
   */
  const [disputes, setDisputes] = useState<OpenDispute[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const found = await repo.listOpenDisputes();
        if (!cancelled) setDisputes(found);
      } catch {
        // The rest of the app is still usable without them.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, revision]);

  const [spaceReviews, setSpaceReviews] = useState<{
    spaceId: string;
    items: PublicReview[];
  } | null>(null);

  useEffect(() => {
    if (!activeSpaceId) return;

    let cancelled = false;
    void (async () => {
      try {
        const items = await repo.listSpaceReviews(activeSpaceId);
        if (!cancelled) setSpaceReviews({ spaceId: activeSpaceId, items });
      } catch {
        // A listing is still worth reading without them.
        if (!cancelled) setSpaceReviews({ spaceId: activeSpaceId, items: [] });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [repo, activeSpaceId]);

  useEffect(() => {
    if (!threadBookingId) return;

    let cancelled = false;
    void (async () => {
      const messages = await repo.listMessages(threadBookingId);
      if (cancelled) return;
      setThread(
        messages.map((m) => ({
          id: m.id,
          senderId: m.senderId,
          body: m.body,
          createdAt: m.createdAt,
          redactedKinds: m.redactedKinds,
        })),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [repo, threadBookingId, revision]);

  /**
   * Nearby ordering, held here rather than in Discover.
   *
   * It survives navigating into a listing and back, which is the ordinary
   * path — asking for someone's location again every time they return from a
   * detail screen would be both annoying and a second permission prompt.
   */
  const [nearbyOrder, setNearbyOrder] = useState<string[] | null>(null);
  const [distanceLabels, setDistanceLabels] = useState<Record<string, string>>({});
  const [locationError, setLocationError] = useState<string | null>(null);
  /** Set only by "book again", so the listing opens on the hour being repeated. */
  const [openAtSlot, setOpenAtSlot] = useState<Date | null>(null);

  /**
   * Rooms they have used, at the hour they used them.
   *
   * Derived rather than stored: the bookings are already loaded, and a second
   * copy of "which rooms does this person use" is a second thing that can be
   * wrong.
   */
  const rebookableRooms = useMemo(
    () => rebookable(data?.bookings ?? [], new Date(), BOOKING_HORIZON_DAYS),
    [data?.bookings],
  );
  /*
   * Held for the map, and for this visit only.
   *
   * Never sent anywhere else and never stored: the server already ranked the
   * listings, and this is only so the map can draw where "here" is. Closing
   * the app forgets it, which is what the location disclosure promises.
   */
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);

  /**
   * Asks the server to rank the listings, and writes only what it answers.
   *
   * Split out from the choice itself because this is the part a saved
   * postcode also needs. An effect that applied the saved one by calling the
   * chooser would setState synchronously on every render it ran in, which is
   * the cascade React warns about — here the only state written is written
   * after the fetch resolves.
   */
  const sortByLocation = useCallback(async (query: string) => {
    try {
      const response = await fetch(`/api/spaces/nearby?${query}`);
      const body = (await response.json()) as {
        spaces?: { id: string; distanceLabel: string }[];
        error?: string;
      };

      if (!response.ok) {
        setLocationError(body.error ?? "We couldn't sort by distance just now.");
        return;
      }

      const ranked = body.spaces ?? [];
      setNearbyOrder(ranked.map((entry) => entry.id));
      setDistanceLabels(Object.fromEntries(ranked.map((e) => [e.id, e.distanceLabel])));
    } catch {
      setLocationError("We couldn't reach the server. Check your connection and try again.");
    }
  }, []);

  const chooseLocation = useCallback(
    async (choice: LocationChoice) => {
      setLocationError(null);
      setHere(choice.kind === "coords" ? { lat: choice.lat, lng: choice.lng } : null);

      /*
       * A postcode is kept; a coordinate is not.
       *
       * The difference is what each one is. A coordinate is where somebody
       * physically is, wanted once to sort a list — storing it would be
       * building a record of their movements to save a tap. A postcode they
       * typed is a preference, and asking again every visit is friction with
       * no privacy bought by it.
       */
      if (choice.kind === "postal") {
        /*
         * Refreshed, not just written.
         *
         * Writing it alone left the screen holding the profile it loaded with,
         * so the saved postcode existed in the database and nowhere the app
         * could see it — the row saying which postcode is in use never
         * appeared, and the prompt was replaced by nothing.
         */
        void repo
          .updateProfile({ searchPostcode: choice.postalCode })
          .then(() => refresh())
          .catch(() => {
            // Sorting still works this visit; the next one will ask again.
          });
      }

      await sortByLocation(
        choice.kind === "coords"
          ? `lat=${choice.lat}&lng=${choice.lng}`
          : `postalCode=${encodeURIComponent(choice.postalCode)}`,
      );
    },
    [repo, refresh, sortByLocation],
  );

  /**
   * Sort by the saved postcode when the app opens.
   *
   * Keyed on the postcode, so changing it re-sorts and nothing else does. A
   * saved postcode means the question has been answered, so the prompt does
   * not appear at all.
   */
  const savedPostcode = data?.profile.searchPostcode ?? null;

  /*
   * The rule cannot see past the call, and there is no synchronous setState
   * behind it: everything sortByLocation writes is written after `await
   * fetch`, which is the "subscribe to an external system and setState in the
   * callback" shape the rule exists to allow. Narrowed to this line so the
   * check still applies everywhere else.
   */
  useEffect(() => {
    if (!savedPostcode) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void sortByLocation(`postalCode=${encodeURIComponent(savedPostcode)}`);
  }, [savedPostcode, sortByLocation]);

  // Read once per render rather than threaded through: it is a build-time
  // constant, and every caller wants the same answer.
  const onSupabase = supabaseBackendEnabled();
  /**
   * Which ways in the auth server will actually accept.
   *
   * Asked rather than assumed. Both OAuth buttons rendered unconditionally and
   * both failed, because neither provider was enabled on the project — two of
   * the three ways in were broken on the first screen anybody sees. A constant
   * would have the same problem the day somebody turns one on.
   */
  // The mock has no auth server to ask, and both routes work in it, so that
  // answer is the initial state rather than an effect that sets it back.
  const [providers, setProviders] = useState<Provider[]>(() =>
    onSupabase ? [] : ["apple", "google"],
  );

  useEffect(() => {
    if (!onSupabase) return;

    // The native shell signs in by email code only. Third-party OAuth is a
    // full-page redirect to the provider, and Google refuses that inside a
    // WebView ("disallowed_useragent"); the email code has no redirect and
    // works there. Offering only email also keeps the store build clear of
    // Apple's Sign in with Apple requirement, which is triggered by third-party
    // social login. So the app skips the provider lookup and the buttons stay
    // hidden (the state already starts empty); the web keeps all of them.
    if (isNativeApp()) return;

    const stop = new AbortController();
    void enabledProviders(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
      stop.signal,
    ).then(setProviders);

    return () => stop.abort();
  }, [onSupabase]);

  /**
   * The screens someone sees before they have an account.
   *
   * They need no data, which is what makes them the only screens that can be
   * rendered while signed out. Everything after this point reads rows that
   * belong to a user.
   */
  const needsAccount =
    onSupabase &&
    (screen === "splash" || screen === "how" || screen === "auth-entry" || screen === "auth-verify");

  /**
   * Nothing is fetched before there is somebody to fetch it for.
   *
   * Every read on the Supabase repository resolves the signed-in user first
   * and throws when there is none — which is the ordinary state of a first
   * visit, not a failure. Without this guard that rejection left `data` null
   * forever and the app rendered its blank loading box to every new visitor,
   * with nothing in the console to say why.
   */
  useEffect(() => {
    if (needsAccount) return;

    let cancelled = false;

    const fetchAll = async (): Promise<Snapshot> => {
      const [
        profile,
        spaces,
        bookings,
        mySpaces,
        hostBookings,
        bookingRequests,
        cancellations,
        sessions,
        notifications,
      ] = await Promise.all([
          repo.getProfile(),
          repo.listPublicSpaces(),
          repo.listMyBookings(),
          repo.listMySpaces(),
          repo.listHostBookings(),
          repo.listBookingRequests(),
          repo.listCancellationHistory(),
          repo.getSessionCount(),
          repo.listNotifications(),
        ]);

      // Address details are per-space and authorization-gated, so they are
      // fetched only for spaces the user actually holds a booking on.
      const access: Record<string, SpaceAccessDetails> = {};
      for (const spaceId of new Set(bookings.map((b) => b.spaceId))) {
        const details = await repo.getSpaceAccessDetails(spaceId);
        if (details) access[spaceId] = details;
      }

      return {
        profile,
        spaces,
        bookings,
        mySpaces,
        hostBookings,
        bookingRequests,
        access,
        cancellations,
        sessions,
        notifications,
      };
    };

    void (async () => {
      for (let attempt = 0; !cancelled; attempt++) {
        try {
          const snapshot = await fetchAll();
          if (cancelled) return;
          setData(snapshot);
          setLoadError(null);
          return;
        } catch (cause) {
          if (cancelled) return;

          /*
           * Some failures are a wait rather than a problem.
           *
           * Signing in with Google landed on "We could not load your account —
           * JWT issued at future", and Try again worked every time: the token
           * is stamped by one server and checked by another a second behind
           * it. Showing that to somebody, on the first screen after they
           * signed in, reads as a broken account. So the app does the waiting
           * — see transient.ts for which errors qualify and why the list is
           * short.
           */
          const delay = isTransient(cause) ? delayFor(attempt) : null;
          if (delay === null) {
            /*
             * A failed load used to render nothing at all.
             *
             * There was no catch here, so one rejected request left `data`
             * null forever and the guard below painted a blank white screen —
             * no message, no retry, nothing to tell anybody whether the app
             * was slow, broken, or signed out. The person looking at it cannot
             * tell those apart, and neither could we.
             */
            setLoadError(errorMessage(cause, "Something went wrong loading your account."));
            return;
          }

          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [repo, revision, needsAccount]);

  const mutate = useCallback(
    async (action: () => Promise<unknown>) => {
      await action();
      refresh();
    },
    [refresh],
  );

  /*
   * Pull-to-refresh's callback. It re-fetches the current screen's data in place
   * through the app's existing `refresh()` (a revision bump, not a page reload),
   * and holds for a short beat so the paw loader reads as a deliberate refresh
   * rather than a flicker. It always resolves, so the gesture can never stick.
   */
  const onPullRefresh = useCallback(async () => {
    refresh();
    await new Promise((resolve) => setTimeout(resolve, 650));
  }, [refresh]);

  /**
   * Deletes, then resets. The order matters only in that the reset must not
   * happen first: a screen re-rendering against an account that still exists
   * would refetch it and look like nothing happened.
   */
  const deleteAccount = useCallback(async () => {
    const response = await fetch("/api/account/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "DELETE" }),
    });

    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not delete the account");

    await repo.signOut();
    reset();
    refresh();
  }, [repo, reset, refresh]);

  const signOut = useCallback(() => {
    void (async () => {
      await repo.signOut();
      reset();
      refresh();
    })();
  }, [repo, reset, refresh]);

  // Defined as functions rather than inlined: they render from above the
  // data guard, while every other screen renders from the switch below.
  const renderAuthEntry = () => (
        <AuthEntry
          providers={providers}
          error={authError}
          busy={authBusy}
          onBack={back}
          onEmail={(value) => {
            setEmail(value);
            setAuthError(null);

            if (!onSupabase) {
              // Mock mode only, against an in-memory repository that cannot
              // reject. The real sign-in above this reports its own failures.
              void mutate(() => repo.updateProfile({ email: value }));
              go("auth-verify");
              return;
            }

            // Only advance once Supabase has accepted it. Showing the code
            // screen first would leave someone staring at six empty boxes
            // waiting for a message that was never sent.
            setAuthBusy(true);
            void (async () => {
              try {
                await sendEmailCode(value);
                go("auth-verify");
              } catch (error) {
                setAuthError(describeAuthError(error));
              } finally {
                setAuthBusy(false);
              }
            })();
          }}
          onProvider={(provider) => {
            setAuthError(null);

            if (!onSupabase) {
              const label = provider === "apple" ? "Apple ID" : "Google account";
              setEmail(label);
              // Mock mode only — see the note on the email branch above.
              void mutate(() => repo.updateProfile({ email: label }));
              go("role");
              return;
            }

            // Leaves the app entirely and comes back through /auth/callback,
            // so there is no success path to handle here — only a failure to
            // start, which happens when the provider is not configured yet.
            void (async () => {
              try {
                await signInWithProvider(provider);
              } catch (error) {
                setAuthError(describeAuthError(error));
              }
            })();
          }}
        />
  );

  const renderAuthVerify = () => (
        <AuthVerify
          email={email}
          error={authError}
          busy={authBusy}
          onBack={back}
          next={(code) => {
            setAuthError(null);

            // The mock has no code to check — see repository-factory.ts.
            if (!onSupabase) {
              go("role");
              return;
            }

            setAuthBusy(true);
            void (async () => {
              try {
                await verifyEmailCode(email, code);
                // Every screen after this writes as the signed-in user, and a
                // user with no profile row hits a foreign key on the first
                // one. Upsert, so a repeat sign-in is harmless.
                await ensureProfile();
                refresh();
                /*
                 * Not the role screen.
                 *
                 * Sending everybody there asked a returning host, whose side
                 * was chosen months ago and cannot change, to choose again —
                 * and the write that followed was refused by the database, so
                 * the button did nothing and said nothing.
                 *
                 * The guards below already know where each account belongs: an
                 * account with no type gets the role screen, a host lands on
                 * their studio, a practitioner on discover. Routing here would
                 * be a second, worse copy of that.
                 */
                go("discover");
              } catch (error) {
                setAuthError(describeAuthError(error));
              } finally {
                setAuthBusy(false);
              }
            })();
          }}
        />
  );

  /**
   * Choosing a side, with the refusal made visible.
   *
   * The write is final — a trigger in the database refuses any change from one
   * value to another. When it refused, the rejection landed in a floating
   * promise nobody was holding: the button did nothing, said nothing, and the
   * person pressed it again.
   *
   * Awaited before navigating, too. Landing on a practitioner screen while the
   * account is still typeless would show somebody a side they may not have
   * chosen.
   */
  const chooseSide = async (accountType: "practitioner" | "host", next: Screen) => {
    setRoleError(null);
    try {
      await repo.updateProfile({ accountType });
      refresh();
      go(next);
    } catch (cause) {
      const message = errorMessage(cause, "");
      setRoleError(
        /account type|final|cannot be changed/i.test(message)
          ? "This account is already set up on the other side, and that cannot be changed. Sign in with a different email to use this one."
          : message || "That did not save. Try again.",
      );
    }
  };

  // Shown from two places: the switch below, and the guard that catches an
  // account which signed in but never answered the question.
  const renderRoleSelect = () => (
        <RoleSelect
          error={roleError}
          choosePractitioner={() => void chooseSide("practitioner", "verify")}
          chooseHost={() => void chooseSide("host", "addspace")}
        />
  );

  // Rendered before the data guard, because these are exactly the screens that
  // exist to get someone to the point where there is data to load.
  if (screen === "splash") return <Splash next={() => go("how")} />;
  if (screen === "how") return <HowItWorks next={() => go("auth-entry")} onBack={back} />;
  if (screen === "auth-entry") return renderAuthEntry();
  if (screen === "auth-verify") return renderAuthVerify();

  if (!data) {
    return loadError ? (
      <LoadFailed message={loadError} onRetry={() => { setLoadError(null); refresh(); }} />
    ) : (
      <div className="h-full bg-white flex items-center justify-center">
        <PawLoader label="Getting things ready…" />
      </div>
    );
  }

  const {
    profile,
    spaces,
    bookings,
    mySpaces,
    hostBookings,
    bookingRequests,
    access,
    cancellations,
    sessions,
  } =
    data;

  // One history, read from each side. The same function answers "how do I
  // stand" on both profiles, so the two can never disagree about a shared
  // cancellation.
  const now = new Date();
  const practitionerStanding = standingFor("practitioner", cancellations, now);
  const hostStanding = standingFor("host", cancellations, now);

  /**
   * The moments each side has reached, counted here because this is the only
   * place holding both sides' rows.
   *
   * Derived every render rather than stored. What gets stored is narrower —
   * which ones have been *shown* — so a milestone can never be granted by
   * writing a row, and can never drift from the bookings it is counted from.
   */
  const hostFacts = hostFactsFrom({
    spaces: mySpaces,
    bookings: hostBookings,
    payoutsReceived: hostBookings.filter((b) => b.hostPaidAt !== null).length,
  });
  const practitionerFacts = practitionerFactsFrom({
    bookings,
    // Reviews written about the practitioner. Not yet surfaced anywhere, so
    // the milestone waits rather than firing on a number we do not have.
    reviewsReceived: 0,
  });

  const hostMilestones = earnedByHost(hostFacts);
  const practitionerMilestones = earnedByPractitioner(practitionerFacts);

  /*
   * One interruption, and only for the side this account is. Somebody who
   * has switched sides should not be stopped by a moment the other one
   * crossed.
   */
  const dueMilestone = celebrationDue(
    profile.accountType === "host" ? hostMilestones : practitionerMilestones,
    // Dismissed here as well as on the server, because this screen renders in
    // front of the whole app. If the write that records it fails and nothing
    // local remembers the tap, "Thanks" does nothing and somebody is shut out
    // of their own account by a congratulation. Seeing it once more on the
    // next visit is the cheaper of the two failures by a long way.
    [...profile.milestonesSeen, ...dismissedMilestones],
  );

  /**
   * A host with no listings goes straight to AddSpace.
   *
   * The brief is explicit that they should never meet an empty dashboard
   * first, and putting the rule here means both entry points — Role Select and
   * the Discover header — obey it without repeating themselves.
   */
  /**
   * Where a host belongs on arrival.
   *
   * The brief is explicit that a host should never meet an empty dashboard
   * first, so one with no listings goes straight to the form. Used by the
   * routing guard below rather than by a switch button, which no longer
   * exists — an account is one side or the other.
   */
  const hostLanding = () => (mySpaces.length === 0 ? renderAddSpace() : renderHostDashboard());

  /**
   * An account that has not chosen a side yet gets exactly one screen.
   *
   * Reached by anyone who signed in and closed the app before answering. Their
   * profile row exists, so the data loads and every screen would render — but
   * which side they belong to is not yet decided, and guessing is how somebody
   * ends up in the wrong half of the app.
   */
  if (onSupabase && profile.accountType === null && screen !== "role" && screen !== "legal") {
    return renderRoleSelect();
  }

  /**
   * And then the terms, once, before anything else.
   *
   * After the side is chosen rather than before it, because half of what is
   * being agreed to differs by side — a host is taking on a sublease
   * declaration, a practitioner is not.
   *
   * The legal screen stays reachable from here, since asking somebody to agree
   * to something they cannot open would make the acceptance worth nothing.
   */
  if (
    onSupabase &&
    !hasAcceptedTerms({ version: profile.termsVersion }) &&
    screen !== "legal"
  ) {
    return (
      <AcceptTerms
        onAccept={() => mutate(() => repo.updateProfile({ termsVersion: TERMS_VERSION }))}
        onReadFull={() => go("legal")}
      />
    );
  }

  /**
   * The first session, said before anything else.
   *
   * After the terms, because nothing should come between somebody and the
   * agreement they have not made yet, and before the ordinary screens because
   * a moment shown three taps later is not a moment.
   *
   * Exactly one milestone reaches here — see `celebrate` in milestones.ts.
   * Dismissing writes the key, so it appears once; whether it was earned is
   * derived from bookings every time and never stored.
   */
  if (dueMilestone) {
    return (
      <MilestoneMoment
        milestone={dueMilestone}
        onDone={() => {
          setDismissedMilestones((seen) => [...seen, dueMilestone.key]);
          // Swallowed on purpose, and only here: the screen has already been
          // dismissed above, so the whole consequence of a failed write is
          // seeing this once more later. There is nothing to tell anybody.
          void mutate(() =>
            repo.updateProfile({
              milestonesSeen: [...profile.milestonesSeen, dueMilestone.key],
            }),
          ).catch(() => {});
        }}
      />
    );
  }

  // Both are rendered from the switch below and from the guard above it, so
  // they are functions rather than inline cases.
  const renderAddSpace = () => (
        <AddSpace
          onBack={() => go("host")}
          hostTermsAccepted={hasAcceptedHostTerms(profile)}
          /*
           * Record the acceptance before the listing, so the row the insert
           * gate checks for — a host at the current Host Terms version — is in
           * place. The database stamps the version and the moment itself; the
           * value sent here is only a request to accept, which it clamps to
           * whatever it currently requires.
           */
          onAcceptHostTerms={async () => {
            await repo.updateProfile({ hostTermsVersion: HOST_TERMS_VERSION });
            refresh();
          }}
          onListed={async (input) => {
            await repo.createSpace(input);
            refresh();
          }}
        />
  );

  const renderDiscover = () => (
        <Discover
          spaces={spaces}
          isPro={profile.isPro}
          onRefresh={onPullRefresh}
          greetingName={profile.displayName}
          rebookable={rebookableRooms}
          onRebook={(entry) => {
            // A gate belongs to the room it was raised on; a new one starts clean.
            setInsuranceGate(null);
            setActiveSpaceId(entry.spaceId);
            setOpenAtSlot(entry.nextStart);
            go("detail");
          }}
          onOpenSpace={(spaceId) => {
            setInsuranceGate(null);
            setOpenAtSlot(null);
            setActiveSpaceId(spaceId);
            go("detail");
          }}
          onGoPro={() => go("pro")}
          onGoBookings={() => go("bookings")}
          onGoNotifications={() => go("notifications")}
          undeliveredCount={data.notifications.filter((n) => n.state === "failed").length}
          onGoProfile={() => go("practitioner-profile")}
          onGoLegal={() => go("legal")}
          you={here}
          savedPostcode={savedPostcode}
          /*
            Clearing it puts the prompt back, which is the whole of "change".
            One control, and the state it produces is the state somebody
            already knows how to answer.
          */
          onChangePostcode={() => {
            setNearbyOrder(null);
            setDistanceLabels({});
            setLocationError(null);
            // Failing quietly here left the prompt on screen over a postcode
            // that was still stored, so the next visit silently sorted by an
            // area somebody thought they had cleared.
            void mutate(() => repo.updateProfile({ searchPostcode: null })).catch((cause) =>
              setLocationError(errorMessage(cause, "We couldn't clear that. Try again.")),
            );
          }}
          nearbyOrder={nearbyOrder}
          onChooseLocation={(choice) => void chooseLocation(choice)}
          distanceLabels={distanceLabels}
          locationError={locationError}
        />
  );

  const renderHostDashboard = () => (
        <HostDashboard
          spaces={mySpaces}
          bookings={hostBookings}
          requests={bookingRequests}
          onRefresh={onPullRefresh}
          /*
           * Refreshed rather than patched in place. Answering moves a booking
           * between two lists that come from two different queries — out of
           * the queue and, on an approval, into the calendar — and keeping a
           * local copy in step with both is how one of them ends up stale.
           */
          onAnswerRequest={async (bookingId, decision, note) => {
            await repo.answerBookingRequest(bookingId, decision, note);
            refresh();
          }}
          onAddSpace={() => go("addspace")}
          onEditHours={(spaceId) => {
            setEditingSpaceId(spaceId);
            go("edit-hours");
          }}
          onEditSpace={(spaceId) => {
            setEditingSpaceId(spaceId);
            go("edit-space");
          }}
          onPreviewSpace={(spaceId) => {
            setInsuranceGate(null);
            setActiveSpaceId(spaceId);
            go("detail");
          }}
          onOpenEarnings={() => go("earnings")}
          onOpenProfile={() => go("host-profile")}
          onGoNotifications={() => go("notifications")}
          undeliveredCount={data.notifications.filter((n) => n.state === "failed").length}
          onReviewBooking={(bookingId) => {
            setReviewing({ bookingId, role: "host" });
            go("review");
          }}
          onReportProblem={(bookingId) => {
            setClaimBookingId(bookingId);
            go("claim");
          }}
          onMessageBooking={(bookingId) => {
            setThreadBookingId(bookingId);
            go("thread");
          }}
          hostTermsVersion={profile.hostTermsVersion}
          hostTermsAcceptedAt={profile.hostTermsAcceptedAt}
        />
  );

  /**
   * A host never lands on the practitioner side, and the reverse.
   *
   * Sign-in and session resume both aim at Discover, which is right for a
   * practitioner and wrong for everybody else — a studio owner opening the app
   * was shown a list of rooms to book, on an account that cannot book one.
   * Correcting it here rather than at each entry point means a screen added
   * later cannot forget.
   */
  const practitionerOnly: Screen[] = [
    "discover",
    "detail",
    "payment",
    "confirmed",
    "bookings",
    "pro",
    "practitioner-profile",
    "verify",
  ];
  const hostOnly: Screen[] = [
    "host",
    "addspace",
    "edit-hours",
    "edit-space",
    "earnings",
    "host-profile",
  ];

  const previewingOwnListing =
    screen === "detail" && mySpaces.some((space) => space.id === activeSpaceId);

  if (
    profile.accountType === "host" &&
    practitionerOnly.includes(screen) &&
    !previewingOwnListing
  ) {
    return hostLanding();
  }
  if (profile.accountType === "practitioner" && hostOnly.includes(screen)) {
    return renderDiscover();
  }

  /**
   * The public catalogue first, then the host's own listings.
   *
   * `spaces` holds live listings only, so previewing a listing still under
   * review found nothing and dropped the host onto the not-found screen —
   * which is the one moment they most want to look, since it is their last
   * chance to fix a photo before anybody else sees it. A host's own record
   * carries everything the public one does.
   */
  const activeSpace =
    spaces.find((s) => s.id === activeSpaceId) ??
    mySpaces.find((s) => s.id === activeSpaceId) ??
    null;
  const activeBooking = bookings.find((b) => b.id === activeBookingId) ?? null;
  const editingSpace = mySpaces.find((s) => s.id === editingSpaceId) ?? mySpaces[0] ?? null;

  switch (screen) {
    case "role":
      return renderRoleSelect();

    case "verify":
      return (
        <InsuranceUpload
          initialDocName={profile.insuranceDocName}
          status={insuranceStatus(
            {
              hasCertificate: profile.insuranceDocName !== null,
              state: profile.insuranceReview.state,
              effectiveDate: profile.insuranceEffectiveDate,
              expiresAt: profile.insuranceExpiresAt,
            },
            new Date(),
          )}
          reviewNote={profile.insuranceReviewNote}
          onBack={back}
          onContinue={(docName) =>
            mutate(() => repo.updateProfile({ insuranceDocName: docName })).then(() =>
              go("discover"),
            )
          }
        />
      );

    case "discover":
      return renderDiscover();

    case "detail":
      if (!activeSpace) return <Fallback onBack={() => go("discover")} />;
      return (
        <SpaceDetail
          space={activeSpace}
          isPro={profile.isPro}
          reviews={spaceReviews?.spaceId === activeSpaceId ? spaceReviews.items : null}
          preview={previewingOwnListing}
          startAt={openAtSlot}
          onBack={back}
          onGoPro={() => go("pro")}
          error={bookingError}
          notice={bookingNotice}
          skipped={seriesSkipped}
          insuranceGate={insuranceGate?.message ?? null}
          insuranceGateReason={insuranceGate?.reason ?? null}
          onAddInsurance={() => {
            setInsuranceGate(null);
            go("verify");
          }}
          onBook={async (startsAt, weeks, declared) => {
            /*
             * Eligibility first, before a card is ever touched.
             *
             * The server enforces this too — planBooking refuses a booking
             * without a professional profile and verified cover valid on the
             * date, and it does so before any row or charge. Running the same
             * check here spares a round trip and, more importantly, turns the
             * refusal into something with a way out: a message beside an "Add
             * insurance" button rather than a bare failure. Every week of a run
             * is checked, since cover good today need not reach the last one.
             */
            setInsuranceGate(null);
            const dates =
              weeks > 1
                ? Array.from(
                    { length: weeks },
                    (_, k) => new Date(startsAt.getTime() + k * 7 * 86_400_000),
                  )
                : [startsAt];
            const gate = bookingEligibilityMessage(profile, dates, new Date());
            if (gate) {
              setInsuranceGate(gate);
              return;
            }

            /*
             * A term goes through its own route, which walks the weeks and
             * books each one under the ordinary rules. It reports what it
             * could not do rather than refusing the lot, so the message is
             * the server's own summary rather than a count invented here.
             */
            if (weeks > 1) {
              setBookingError(null);
              const response = await fetch("/api/bookings/series", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  spaceId: activeSpace.id,
                  startsAt: startsAt.toISOString(),
                  weeks,
                  purpose: declared.purpose,
                  purposeNote: declared.purposeNote ?? null,
                  attendees: declared.attendees,
                }),
              });
              const body = await response.json().catch(() => ({}));

              if (!response.ok) {
                setBookingError(body.error ?? "Those weeks could not be booked.");
                return;
              }

              refresh();
              // Said where they acted rather than on a screen they were sent
              // to. "3 of 4 booked" is only useful next to the fourth.
              setBookingNotice(body.summary ?? null);
              setSeriesSkipped(body.skipped ?? []);
              return;
            }

            /*
             * Awaited, and the refusal shown.
             *
             * This was a floating promise: a booking that failed — the hour
             * taken a second earlier, the host's payouts not finished, the
             * session expired — rejected into nothing. The button was pressed,
             * the screen did not move, and there was no way to tell a slow
             * network from a refusal. Every reason the server gives is written
             * for the person reading it.
             */
            setBookingError(null);
            try {
              const { booking, clientSecret } = await repo.createBooking({
                spaceId: activeSpace.id,
                startsAt,
                declared,
              });
              setActiveBookingId(booking.id);
              setClientSecret(clientSecret);
              refresh();
              // The booking row exists either way. A clientSecret means a card
              // still has to be confirmed against it; without one there is
              // nothing left to do and the payment screen would be a lie.
              go(clientSecret ? "payment" : "confirmed");
            } catch (cause) {
              setBookingError(
                errorMessage(cause, "That booking did not go through. Try again."),
              );
            }
          }}
        />
      );

    case "payment":
      if (!activeBooking || !clientSecret) return <Fallback onBack={() => go("discover")} />;
      return (
        <PaymentSheet
          clientSecret={clientSecret}
          money={activeBooking}
          spaceName={activeBooking.spaceName}
          startsAt={activeBooking.startsAt}
          timeZone={activeBooking.timeZone}
          /**
           * Back leaves the booking in place, holding the slot, unpaid.
           *
           * Deleting it here would be worse in both directions: a practitioner
           * who meant to switch cards would lose the slot, and a slot released
           * on every back-tap is a slot that flickers in and out of other
           * people's searches. The capture job settles what is never paid.
           */
          onBack={() => {
            setClientSecret(null);
            go("discover");
          }}
          onPaid={() => {
            setClientSecret(null);
            refresh();
            go("confirmed");
          }}
        />
      );

    case "review": {
      if (!reviewing) return <Fallback onBack={() => go("discover")} />;

      /**
       * The booking is looked up in whichever list matches the side writing.
       * A host's own bookings never appear in listMyBookings, and a
       * practitioner's never appear in listHostBookings, so asking the wrong
       * one is how a review screen renders empty for exactly one role.
       */
      const target =
        reviewing.role === "practitioner"
          ? bookings.find((b) => b.id === reviewing.bookingId)
          : hostBookings.find((b) => b.id === reviewing.bookingId);

      if (!target) return <Fallback onBack={back} />;

      return (
        <ReviewScreen
          subjectName={
            reviewing.role === "practitioner"
              ? (target as Booking).spaceName
              : (target as HostBooking).practitionerName
          }
          role={reviewing.role}
          onBack={back}
          onSubmit={async (draft) => {
            await repo.submitReview({ bookingId: reviewing.bookingId, ...draft });
            setReviewing(null);
            refresh();
            back();
          }}
        />
      );
    }

    case "refund": {
      const subject = bookings.find((b) => b.id === refundBookingId);
      if (!subject) return <Fallback onBack={back} />;

      return (
        <RefundRequest
          booking={subject}
          onBack={back}
          onSubmit={async (input) => {
            const response = await fetch(`/api/bookings/${subject.id}/refund`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(input),
            });

            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error ?? "That did not send.");

            // The list is stale the moment a request is decided on the spot —
            // a refunded booking is not one you can ask about again.
            refresh();
            return body;
          }}
        />
      );
    }

    case "claim": {
      const subject = hostBookings.find((b) => b.id === claimBookingId);
      const room = subject ? spaces.find((s) => s.id === subject.spaceId) : undefined;
      if (!subject || !room) return <Fallback onBack={back} />;

      return (
        <ClaimForm
          spaceName={room.name}
          hourlyRateCents={room.hourlyRateCents}
          onBack={back}
          onSubmit={async (input) => {
            const response = await fetch(`/api/bookings/${subject.id}/claim`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(input),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error ?? "That did not send.");
            refresh();
            return body;
          }}
        />
      );
    }

    case "disputes":
      return (
        <Disputes
          disputes={disputes}
          onBack={back}
          onReply={async (dispute, reply) => {
            const url =
              dispute.kind === "refund" ? `/api/refunds/${dispute.id}` : `/api/claims/${dispute.id}`;
            const field = dispute.kind === "refund" ? { reply } : { reply };

            const response = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(field),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error ?? "That did not send.");
            refresh();
          }}
        />
      );

    case "thread": {
      if (!threadBookingId) return <Fallback onBack={() => go("discover")} />;

      /*
        The counterpart is whichever side this account is not. A practitioner's
        own bookings carry the space name; a host's carry the practitioner's.
      */
      const mine = bookings.find((b) => b.id === threadBookingId);
      const theirs = hostBookings.find((b) => b.id === threadBookingId);
      const subject = mine ?? theirs;

      if (!subject) return <Fallback onBack={back} />;

      return (
        <Thread
          messages={thread}
          meId={profile.id}
          otherName={mine ? "the studio" : (theirs as HostBooking).practitionerName}
          spaceName={mine ? mine.spaceName : "your space"}
          when={sessionDayShort(
            subject.startsAt,
            mine?.timeZone ??
              spaces.find((s) => s.id === theirs?.spaceId)?.timeZone ??
              FALLBACK_ZONE,
          )}
          onBack={() => {
            setThreadBookingId(null);
            back();
          }}
          onSend={async (body) => {
            const result = await repo.sendMessage(threadBookingId, body);
            refresh();
            return result;
          }}
        />
      );
    }

    case "confirmed":
      if (!activeBooking) return <Fallback onBack={() => go("discover")} />;
      return (
        <Confirmed
          booking={activeBooking}
          access={access[activeBooking.spaceId] ?? null}
          // Only worth offering when it would actually have saved money.
          showProUpsell={!profile.isPro && activeBooking.instantFeeCents > 0}
          onGoPro={() => go("pro")}
          onDone={() => go("discover")}
        />
      );

    case "bookings":
      return (
        <MyBookings
          bookings={bookings}
          onRefresh={onPullRefresh}
          accessFor={(spaceId) => access[spaceId] ?? null}
          // The street off the public catalogue rather than off `access`.
          // `access` opens a day before the session; the address has been
          // public since 0032, and somebody telling a client where to be next
          // Tuesday should not have to wait until Monday to do it.
          addressFor={(spaceId) => spaces.find((s) => s.id === spaceId)?.addressLine ?? null}
          isPro={profile.isPro}
          onGoPro={() => go("pro")}
          standing={practitionerStanding}
          onBack={back}
          onCancel={(id) => mutate(() => repo.cancelBooking(id, "practitioner"))}
          onReview={(id) => {
            setReviewing({ bookingId: id, role: "practitioner" });
            go("review");
          }}
          onAskRefund={(id) => {
            setRefundBookingId(id);
            go("refund");
          }}
          onMessage={(id) => {
            setThreadBookingId(id);
            go("thread");
          }}
        />
      );

    case "practitioner-profile":
      return (
        <PractitionerProfile
          profile={profile}
          onRefresh={onPullRefresh}
          milestones={practitionerMilestones}
          milestoneTotal={practitionerTotal(practitionerFacts)}
          sessions={sessions}
          onDeleteAccount={deleteAccount}
          bookingsCount={bookings.length}
          standing={practitionerStanding}
          onBack={back}
          onUpdate={(patch) => mutate(() => repo.updateProfile(patch))}
          onPickAvatar={(file) => mutate(() => repo.uploadAvatar(file))}
          onGoLegal={() => go("legal")}
          onGoDisputes={() => go("disputes")}
          onRequestAccountChange={async (reason) => {
            const response = await fetch("/api/account/change-request", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                requestedType: profile.accountType === "host" ? "practitioner" : "host",
                reason,
              }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error ?? "That did not send.");
          }}
          disputesWaiting={disputes.filter((d) => d.awaitingYou).length}
          onGoInsurance={() => go("verify")}
          onSignOut={signOut}
        />
      );

    case "pro":
      return (
        <ProScreen
          isPro={profile.isPro}
          onBack={back}
          onSubscribe={() => mutate(() => repo.startProSubscription())}
        />
      );

    case "notifications":
      return <Notifications entries={data.notifications} onBack={back} />;

    case "host-spaces":
      return (
        <HostSpaces
          spaces={mySpaces}
          bookings={hostBookings}
          onRefresh={onPullRefresh}
          onBack={back}
          onAddSpace={() => go("addspace")}
          onOpenSpace={(spaceId) => {
            setEditingSpaceId(spaceId);
            go("edit-space");
          }}
          onSetListed={(spaceId, listed) => mutate(() => repo.setSpaceListed(spaceId, listed))}
        />
      );

    case "legal":
      return (
        <Legal
          onBack={back}
          /*
           * Out to the published document, in a new tab.
           *
           * The full text is one thing, served at one address, and /terms is
           * what an acceptance is recorded against — rendering a second copy
           * inside the app is how the two drift and every stored acceptance
           * becomes unverifiable. A new tab so somebody reading a policy does
           * not lose where they were in the app.
           *
           * Relative, and that is load-bearing rather than tidy. /terms and
           * /privacy live at src/app, which is the app host; the content host
           * has proxy.ts rewrite everything into /site, where no terms page
           * exists. An absolute link to the .com would have 404'd — the two
           * documents are only served here.
           */
          onOpen={(path) => window.open(path, "_blank", "noopener,noreferrer")}
        />
      );

    case "host":
      return renderHostDashboard();

    case "addspace":
      return renderAddSpace();

    case "edit-hours":
      if (!editingSpace) return <Fallback onBack={() => go("host")} />;
      return (
        <EditAvailability
          space={editingSpace}
          onBack={() => go("host")}
          onSave={(blocks) =>
            mutate(() => repo.updateSpaceAvailability(editingSpace.id, blocks))
          }
        />
      );

    case "edit-space": {
      if (!editingSpace) return <Fallback onBack={() => go("host")} />;

      /*
       * Counted here rather than asked of the server, from the bookings the
       * screen already has. The database refuses the move regardless — this is
       * so the host sees the address locked before they type into it, instead
       * of after the save fails.
       */
      const now = new Date();
      const booked = hostBookings.filter(
        (b) => b.spaceId === editingSpace.id && b.status === "upcoming" && b.startsAt > now,
      ).length;

      return (
        <EditSpace
          space={editingSpace}
          bookedSessions={booked}
          onBack={() => go("host")}
          onSave={(edit) => mutate(() => repo.editSpace(editingSpace.id, edit))}
          onAddMedia={(files) => mutate(() => repo.addSpaceMedia(editingSpace.id, files))}
          onRemoveMedia={(mediaId) =>
            mutate(() => repo.removeSpaceMedia(editingSpace.id, mediaId))
          }
          onSetListed={(listed) => mutate(() => repo.setSpaceListed(editingSpace.id, listed))}
          onEditHours={() => go("edit-hours")}
        />
      );
    }

    case "earnings":
      return <Earnings spaces={mySpaces} bookings={hostBookings} onBack={back} />;

    case "host-profile":
      return (
        <HostProfile
          profile={profile}
          milestones={hostMilestones}
          milestoneTotal={hostTotal(hostFacts)}
          sessions={sessions}
          onDeleteAccount={deleteAccount}
          spaces={mySpaces}
          standing={hostStanding}
          onBack={back}
          onUpdate={(patch) => mutate(() => repo.updateProfile(patch))}
          onPickAvatar={(file) => mutate(() => repo.uploadAvatar(file))}
          onGoLegal={() => go("legal")}
          onGoSpaces={() => go("host-spaces")}
          onConnectPayouts={() => mutate(() => repo.connectPayouts())}
          onOpenPayoutDashboard={() => repo.openPayoutDashboard()}
          onSignOut={signOut}
        />
      );
  }
}

/**
 * What to show someone whose sign-in failed.
 *
 * Supabase's messages are already written for the person rather than the
 * developer — "Token has expired or is invalid" — so they are passed through.
 * The fallback covers a network failure, where there is no message at all and
 * the honest thing is to say the attempt did not reach us.
 */
function describeAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return message || "We couldn't reach the server. Check your connection and try again.";
}

/** Reached only if a screen is opened without the record it needs. */
/**
 * Something did not load, said out loud.
 *
 * What this replaces is a blank white screen. A person cannot tell a slow
 * network from a broken app from a signed-out session by looking at nothing,
 * so this says which it was and offers the one action that ever helps.
 */
function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center px-9 text-center bg-white">
      <p className="font-display italic font-semibold text-[19px] text-navy">
        We could not load your account
      </p>
      <p className="font-body font-normal text-[14px] leading-relaxed mt-2 text-ink-soft">
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-6 px-7 py-3 rounded-full font-body font-medium text-[14.5px] text-white press"
        style={{ backgroundColor: "#2578C2" }}
      >
        Try again
      </button>
    </div>
  );
}

function Fallback({ onBack }: { onBack: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 bg-white px-9 text-center">
      <p className="font-body font-normal text-[14.5px] text-ink-soft">
        That page needs something we couldn&apos;t find.
      </p>
      <button
        type="button"
        onClick={onBack}
        className="px-6 py-3 rounded-full font-body font-medium text-[14.5px] text-white press"
        style={{ backgroundColor: "#2578C2" }}
      >
        Go back
      </button>
    </div>
  );
}
