"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  Booking,
  BookingRequest,
  ClassTemplate,
  CoverageRequest,
  HostBooking,
  HostSpace,
  Profile,
  PublicSpace,
  OpenDispute,
  PublicReview,
  ReferralSummary,
  RequestInterest,
  RosterMember,
  SpaceAccessDetails,
  WorkOpportunity,
  WorkPreferences,
} from "@/lib/domain";
import type { AvailabilityBlock } from "@/lib/availability";
import { viewerZone } from "@/lib/timezone";
import { type WorkEligibilityGap, workEligibility } from "@/lib/work/eligibility";
import { entitlementsFor } from "@/lib/entitlements";
import { canSendInvite, inviteControlState } from "@/lib/work/roster-invite";
import { apiFetch } from "@/lib/api-fetch";
import {
  SPACE_DEEP_LINK_PARAM,
  clearPendingSpace,
  readPendingSpace,
  readSpaceDeepLink,
  resolveSpaceDeepLink,
  writePendingSpace,
} from "@/lib/space-deep-link";
import { errorMessage } from "@/lib/error-message";
import { delayFor, isTransient } from "@/lib/transient";
import { hostFactsFrom, practitionerFactsFrom } from "@/lib/milestone-facts";
import {
  REFERRAL_PARAM,
  clearPendingReferral,
  readPendingReferral,
  runAttribution,
  writePendingReferral,
} from "@/lib/referrals";
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
  exchangeOAuthCode,
  sendEmailCode,
  signInWithPassword,
  signInWithProvider,
  verifyEmailCode,
} from "@/lib/supabase/auth";

import { describeAuthError } from "@/lib/auth-error";
import { type Provider, enabledProviders } from "@/lib/auth-providers";
import { NATIVE_AUTH_REDIRECT, capacitorPlugin, hasNativeOAuthSupport, isNativeApp } from "@/lib/native";
import { BOOKING_HORIZON_DAYS } from "@/lib/money";
import { SESSION_MS } from "@/lib/session";
import { explainRejection } from "@/lib/booking-plan";
import { resolveActiveBooking } from "@/lib/active-booking";
import { proofFor } from "@/lib/professions";
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
import { bookingAcceptsMessages, messagingDisabledReason } from "@/lib/messaging";
import {
  CredentialUpload,
  InsuranceUpload,
  PractitionerProfile,
  ProScreen,
} from "./screens/practitioner-extras";
import { AuthEntry, AuthVerify, HowItWorks, RoleSelect, Splash } from "./screens/shared";
import { SpaceDetail } from "./screens/space-detail";
import { WorkPractitioner, WorkStudio } from "./screens/work";
import { WorkAvailabilityEditor } from "./screens/work-availability";
import { ClassTemplates } from "./screens/class-templates";
import { CoverageDetail, CoveragePost } from "./screens/coverage";
import { StudioProScreen } from "./screens/studio-pro";
import { RosterScreen } from "./screens/roster";

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
  reason: InsuranceRejection | "professional_profile_required" | "identity_verification_required";
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

  // Identity before cover, matching the server gate order. A client-side mirror
  // only — the server is still the gate that cannot be bypassed — so the refusal
  // arrives with a way to fix it rather than as a dead-ended round trip.
  if (profile.identityVerifiedAt === null) {
    return {
      message: explainRejection("identity_verification_required").message,
      reason: "identity_verification_required",
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
  /** Founding Host spots still open, from the server's own count. */
  foundingRemaining: number;
  /** Founding Practitioner spots still open, from the server's own count. */
  foundingPractitionerRemaining: number;
  /** This host's shareable referral code, assigned by the server on first read. */
  referralCode: string;
  /** This host's referrals, as safe status summaries — no referred-host data. */
  referrals: ReferralSummary[];
  /** Unread incoming messages per booking id, from server truth. */
  unreadCounts: Record<string, number>;
  /* ---- Work (empty/default for the side that does not use each) ---- */
  workPreferences: WorkPreferences;
  workAvailability: AvailabilityBlock[];
  workOpportunities: WorkOpportunity[];
  classTemplates: ClassTemplate[];
  coverageRequests: CoverageRequest[];
  /** The host's trusted-substitute network (Studio Pro). Empty for practitioners. */
  roster: RosterMember[];
}

/** Work preferences a fetch failure falls back to — everything off, nothing set. */
const WORK_PREFERENCES_FALLBACK: WorkPreferences = {
  availableForWork: false,
  workTimeZone: "America/Los_Angeles",
  hasLocation: false,
  basePostcode: null,
  maxTravelMiles: null,
  minPayCents: null,
  openToOnetime: true,
  openToRecurring: false,
};

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
    activeCoverageId,
    setActiveCoverageId,
    revision,
    refresh,
  } = useApp();

  const [data, setData] = useState<Snapshot | null>(null);
  const [coverageInterest, setCoverageInterest] = useState<RequestInterest[]>([]);
  const [loadingInterest, setLoadingInterest] = useState(false);
  const [workBusyId, setWorkBusyId] = useState<string | null>(null);
  const [workSaving, setWorkSaving] = useState(false);
  // The past request being reposted (prefills the post form), if any.
  const [duplicateSource, setDuplicateSource] = useState<CoverageRequest | null>(null);
  // Roster invites already sent this session, keyed `${requestId}:${practitionerId}`
  // so a member shows "Invited" and a repeat tap is prevented across navigation.
  const [invitedInviteKeys, setInvitedInviteKeys] = useState<Set<string>>(() => new Set());
  // Invites in flight, by practitioner id — a set so inviting a second member
  // never releases the first member's lock.
  const [invitingRosterIds, setInvitingRosterIds] = useState<Set<string>>(() => new Set());
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
  /**
   * The booking just created for checkout, held here so the payment and
   * confirmation screens can render it.
   *
   * A fresh instant booking is an uncaptured hold, and listMyBookings hides
   * holds by design — so the snapshot's `bookings` never contains the row we
   * are about to pay for. Without this the payment screen looked the booking up
   * in that list, found nothing, and dropped onto the not-found fallback. It is
   * only a fallback: once the webhook captures the booking it reappears in the
   * list, which takes precedence.
   */
  const [checkoutBooking, setCheckoutBooking] = useState<Booking | null>(null);

  /**
   * Pro checkout confirmation, kept honest.
   *
   * `confirmingPro` is the short wait after returning from Stripe with a real
   * payment while the webhook flips is_pro; `justUpgraded` adds the one-time
   * confetti once that flip is actually observed on the server. Neither ever
   * grants Pro — the success screen is gated on the loaded profile's isPro — so
   * a cancelled or abandoned checkout can never reach it.
   */
  const [confirmingPro, setConfirmingPro] = useState(false);
  const [justUpgraded, setJustUpgraded] = useState(false);
  // Set the moment checkout is opened, so a native return (which carries no URL
  // marker, unlike the web redirect) knows to confirm on resume.
  const checkoutStartedRef = useRef(false);
  // The ?pro= redirect marker is acted on once per load, never replayed.
  const proReturnHandledRef = useRef(false);
  // Held while an OAuth sign-in is being started, so a rapid double-tap on a
  // provider button can never launch two browser flows at once.
  const oauthInFlightRef = useRef(false);

  // Studio Pro checkout, confirmed the same honest way as Pro — the success
  // screen is gated on the server's studio_pro, never on "checkout opened".
  const [confirmingStudioPro, setConfirmingStudioPro] = useState(false);
  const studioProCheckoutStartedRef = useRef(false);
  const studioProReturnHandledRef = useRef(false);

  /**
   * Identity verification, confirmed the same honest way Pro is.
   *
   * `confirmingIdentity` is the short "Checking your verification…" wait after
   * returning from Stripe while the webhook writes identity_verified_at. It
   * never marks anyone verified — the profile the poll re-reads from the server
   * is the only thing that does — so a failed or abandoned check simply drops
   * back to the unverified retry state. Bounded, so it cannot poll forever.
   */
  const [confirmingIdentity, setConfirmingIdentity] = useState(false);
  const identityStartedRef = useRef(false);
  const identityReturnHandledRef = useRef(false);

  // A referral link's ?ref= code, captured before sign-in and applied once after.
  const referralAttributedRef = useRef(false);

  // A ?space= deep link's target listing, captured (and stripped) on arrival and
  // opened once the authenticated catalogue has loaded. Held in a ref so it
  // survives the sign-in flow without re-rendering, and never resolved
  // anonymously: the id is only ever matched against listings this user already
  // loaded, so a removed or inaccessible one simply falls through to Discover.
  const pendingSpaceRef = useRef<string | null>(null);
  const spaceDeepLinkConsumedRef = useRef(false);

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
    const bookingId = threadBookingId;

    let cancelled = false;
    const load = async () => {
      const messages = await repo.listMessages(bookingId);
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
      // Reading the thread marks its incoming messages read (server truth); clear
      // this booking's badge locally so it does not linger until the next load.
      const marked = await repo.markMessagesRead(bookingId).catch(() => 0);
      if (!cancelled && marked > 0) {
        setData((prev) =>
          prev ? { ...prev, unreadCounts: { ...prev.unreadCounts, [bookingId]: 0 } } : prev,
        );
      }
    };

    void load();
    /*
     * A safe poll rather than Supabase Realtime. Realtime on the messages table
     * broadcasts the whole changed row — original_body included — to subscribers,
     * and column-level grants are not reliably applied to that payload, so a live
     * subscription would reintroduce the very leak 0063 closes. Re-reading the
     * redacted view every few seconds brings in incoming messages without ever
     * putting original_body on the wire. Stops the moment the thread closes.
     */
    const poll = setInterval(() => void load(), 5000);

    return () => {
      cancelled = true;
      clearInterval(poll);
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
      // Distance ranking is inside the signed-in marketplace now, so this needs
      // the session — apiFetch, which carries the cookie on the web and the
      // native bearer token in the shell. The response is still only ids and
      // coarse labels; the coordinates it sorts on never leave the server.
      const response = await apiFetch(`/api/spaces/nearby?${query}`);
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

    // Both web and native ask the auth server which providers are enabled and
    // render only those (never a hardcoded button that would fail). Native OAuth
    // opens the provider in the system browser and returns via a deep link — see
    // signInWithProvider and the appUrlOpen handler below.
    //
    // SAFETY FOR THE LIVE BINARY: a native build only fetches providers when it
    // can actually complete the flow — i.e. it ships the Capacitor Browser/App
    // plugins (hasNativeOAuthSupport). The current App Store binary (1.0.0) does
    // not, so it stays email-only and can never show a Google/Apple button that
    // dead-ends; the 1.0.1 binary that ships those plugins lights the buttons up
    // once the providers are also enabled server-side. So this whole OAuth path
    // is dormant on today's live app regardless of Supabase configuration.
    if (isNativeApp() && !hasNativeOAuthSupport()) return;

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
        foundingRemaining,
        foundingPractitionerRemaining,
        referralCode,
        referrals,
        unreadCounts,
        workPreferences,
        workAvailability,
        workOpportunities,
        classTemplates,
        coverageRequests,
        roster,
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
          repo.foundingHostsRemaining(),
          // Falls back to 0 (badge simply hidden) so the whole account still
          // loads if the code is ever deployed before migration 0068 adds the
          // founding_practitioners_remaining() function.
          repo.foundingPractitionersRemaining().catch(() => 0),
          // The referral area is a small dashboard extra; a hiccup fetching it
          // must never keep somebody out of their whole account.
          repo.myReferralCode().catch(() => ""),
          repo.listReferrals().catch(() => []),
          // Unread message badges — a convenience; an empty map on failure.
          repo.unreadMessageCounts().catch(() => ({})),
          // Work is a whole extra area; a hiccup fetching any of it must never
          // keep somebody out of their account. Each side reads only its own.
          repo.getWorkPreferences().catch(() => WORK_PREFERENCES_FALLBACK),
          repo.getWorkAvailability().catch(() => []),
          repo.listWorkOpportunities().catch(() => []),
          repo.listClassTemplates().catch(() => []),
          repo.listCoverageRequests().catch(() => []),
          // Host-only, Studio-Pro-gated (403 for everyone else) — an empty list
          // on any failure, like the rest of Work.
          repo.listRoster().catch(() => []),
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
        foundingRemaining,
        foundingPractitionerRemaining,
        referralCode,
        referrals,
        unreadCounts,
        workPreferences,
        workAvailability,
        workOpportunities,
        classTemplates,
        coverageRequests,
        roster,
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

  /**
   * The interest on the coverage request the studio is looking at.
   *
   * Loaded on its own (not part of the shell snapshot) because it is a
   * per-request, host-only, cross-account read, and re-run on `revision` so a
   * confirm or a new interest refreshes it.
   */
  useEffect(() => {
    if (screen !== "coverage-detail" || !activeCoverageId) return;
    let cancelled = false;
    void (async () => {
      setLoadingInterest(true);
      try {
        const rows = await repo.listRequestInterest(activeCoverageId);
        if (!cancelled) setCoverageInterest(rows);
      } catch {
        if (!cancelled) setCoverageInterest([]);
      } finally {
        if (!cancelled) setLoadingInterest(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, screen, activeCoverageId, revision]);

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
   * Confirm a Pro checkout against the server, then celebrate — never before.
   *
   * Called when a checkout returns (the web ?pro=started redirect, or a native
   * resume after one was opened). It re-reads the account, showing a brief
   * "confirming" wait while the subscription webhook lands, and turns the screen
   * Pro only when the server itself says so — applying that server profile
   * rather than any client guess. A webhook that never confirms leaves the
   * account Free and the screen back on the offer; nothing here fabricates Pro.
   * Bounded, so it can never poll forever.
   */
  const confirmProSubscription = useCallback(async () => {
    setConfirmingPro(true);
    for (let attempt = 0; attempt < 6; attempt++) {
      const profile = await repo.getProfile().catch(() => null);
      if (profile?.isPro) {
        setData((prev) => (prev ? { ...prev, profile } : prev));
        setJustUpgraded(true); // a real, server-confirmed upgrade — confetti once
        setConfirmingPro(false);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    setConfirmingPro(false); // gave the webhook long enough; still Free
  }, [repo]);

  /**
   * The confetti is a one-time thing, so it clears itself. Reopening the Pro
   * screen later shows "You're Pro" without replaying the celebration.
   */
  useEffect(() => {
    if (!justUpgraded) return;
    const timer = setTimeout(() => setJustUpgraded(false), 6000);
    return () => clearTimeout(timer);
  }, [justUpgraded]);

  /** Studio Pro's twin of confirmProSubscription — polls the server's studio_pro
   *  after a real checkout; never grants it. */
  const confirmStudioProSubscription = useCallback(async () => {
    setConfirmingStudioPro(true);
    for (let attempt = 0; attempt < 6; attempt++) {
      const profile = await repo.getProfile().catch(() => null);
      if (profile?.studioPro) {
        setData((prev) => (prev ? { ...prev, profile } : prev));
        setConfirmingStudioPro(false);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    setConfirmingStudioPro(false);
  }, [repo]);

  /** Returning from Studio Pro checkout on the web: ?studiopro=started. */
  useEffect(() => {
    if (studioProReturnHandledRef.current || !data || typeof window === "undefined") return;
    const marker = new URLSearchParams(window.location.search).get("studiopro");
    if (marker !== "started" && marker !== "cancelled") return;
    studioProReturnHandledRef.current = true;
    window.history.replaceState({}, "", window.location.pathname);
    go("studio-pro");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (marker === "started") void confirmStudioProSubscription();
  }, [data, go, confirmStudioProSubscription]);

  /** Returning from Studio Pro checkout in the native shell (no URL marker). */
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        studioProCheckoutStartedRef.current &&
        !data?.profile.studioPro
      ) {
        studioProCheckoutStartedRef.current = false;
        void confirmStudioProSubscription();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [data?.profile.studioPro, confirmStudioProSubscription]);

  /**
   * Returning from Stripe on the web. The redirect lands on ?pro=started or
   * ?pro=cancelled; the marker is stripped so a reload cannot replay it, and
   * only a started checkout begins confirmation — a cancel stays Free with no
   * confetti. Acted on once the account is loaded, and only once per load.
   */
  useEffect(() => {
    if (proReturnHandledRef.current || !data || typeof window === "undefined") return;

    const marker = new URLSearchParams(window.location.search).get("pro");
    if (marker !== "started" && marker !== "cancelled") return;

    proReturnHandledRef.current = true;
    window.history.replaceState({}, "", window.location.pathname);
    go("pro");
    // Starting confirmation is the whole point of handling the redirect; it sets
    // state, which is exactly what this one-time effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (marker === "started") void confirmProSubscription();
  }, [data, go, confirmProSubscription]);

  /**
   * A cancelled or denied WEB OAuth returns to /?authError=<reason> (see
   * auth/callback/route.ts) — the app boots on splash, so without this the
   * message is dropped. Surface it once on the sign-in screen and strip the
   * marker so a reload cannot replay it. Native reports its own errors below.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const reason = url.searchParams.get("authError");
    if (!reason) return;
    url.searchParams.delete("authError");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    const friendly = /denied|cancel/i.test(reason)
      ? "Sign-in was cancelled."
      : describeAuthError(new Error(reason));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAuthError(friendly);
    go("auth-entry");
  }, [go]);

  /**
   * Native OAuth returns through the custom-scheme deep link (see
   * signInWithProvider): the system browser finished the provider flow, and here
   * we exchange the code for a session in the localStorage client and land the
   * user — or surface a cancellation/error. The native return does not re-run
   * the mount bootstrap, so this routes to discover itself. Dormant on the web
   * and until the native build ships the Capacitor App/Browser plugins.
   */
  useEffect(() => {
    if (!isNativeApp()) return;
    const capApp = capacitorPlugin<{
      addListener: (
        event: string,
        cb: (data: { url?: string }) => void,
      ) => Promise<{ remove: () => void }>;
    }>("App");
    if (!capApp) return;

    const browser = capacitorPlugin<{ close?: () => Promise<void> }>("Browser");
    const sub = capApp.addListener("appUrlOpen", (event) => {
      const url = event?.url;
      if (!url || !url.startsWith(NATIVE_AUTH_REDIRECT)) return;
      void (async () => {
        const params = new URL(url).searchParams;
        const reason = params.get("error_description") ?? params.get("error");
        const code = params.get("code");
        try {
          if (reason) throw new Error(reason);
          if (!code) throw new Error("Sign-in was cancelled.");
          await exchangeOAuthCode(code);
          await ensureProfile();
          refresh();
          go("discover");
        } catch (error) {
          setAuthError(describeAuthError(error));
          go("auth-entry");
        } finally {
          await browser?.close?.();
        }
      })();
    });

    return () => {
      void sub.then((s) => s.remove());
    };
  }, [go, refresh]);

  /**
   * Returning from Stripe in the native shell. There is no URL marker — the
   * checkout opened out of the WebView — so a resume after checkout was started,
   * while still Free, is the signal to confirm. Guarded by the ref so ordinary
   * backgrounding never triggers it.
   */
  useEffect(() => {
    if (typeof document === "undefined") return;

    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        checkoutStartedRef.current &&
        !data?.profile.isPro
      ) {
        checkoutStartedRef.current = false;
        void confirmProSubscription();
      }
    };

    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [data?.profile.isPro, confirmProSubscription]);

  /**
   * Confirm an identity check against the server, then show verified — never
   * before. Re-reads the profile a few times while the Stripe Identity webhook
   * writes identity_verified_at, showing "Checking your verification…" until it
   * lands. If the webhook never confirms (a failed or abandoned check) the
   * account stays unverified and the row falls back to a plain retry state.
   * Bounded, so it can never poll forever, and it fabricates nothing.
   */
  const confirmIdentityVerification = useCallback(async () => {
    setConfirmingIdentity(true);
    for (let attempt = 0; attempt < 6; attempt++) {
      const profile = await repo.getProfile().catch(() => null);
      if (profile?.identityVerifiedAt) {
        setData((prev) => (prev ? { ...prev, profile } : prev));
        setConfirmingIdentity(false);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    setConfirmingIdentity(false); // gave the webhook long enough; still unverified
  }, [repo]);

  /**
   * Returning from Stripe Identity on the web. The redirect lands on
   * ?identity=checking; the marker is stripped so a reload cannot replay it, the
   * profile screen is shown so its identity row carries the state, and the
   * bounded poll begins. Acted on once the account is loaded, once per load.
   */
  useEffect(() => {
    if (identityReturnHandledRef.current || !data || typeof window === "undefined") return;

    const marker = new URLSearchParams(window.location.search).get("identity");
    if (marker !== "checking") return;

    identityReturnHandledRef.current = true;
    window.history.replaceState({}, "", window.location.pathname);
    go("practitioner-profile");
    // Starting confirmation is the whole point of handling the return; it sets
    // state, which is exactly what this one-time effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void confirmIdentityVerification();
  }, [data, go, confirmIdentityVerification]);

  /**
   * A referral link, remembered from before sign-in.
   *
   * The code arrives as ?ref= on the very first visit, long before there is an
   * account to attribute it to — and it has to survive the whole auth redirect.
   * So it is copied into localStorage and stripped from the URL on arrival, then
   * applied once the account exists. Only the ref param is removed, so a link
   * that also carries another marker keeps it.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const code = url.searchParams.get(REFERRAL_PARAM);
    if (!code) return;
    // Remembered unbound: the first account to attempt it will bind it to itself.
    writePendingReferral({ code, boundTo: null });
    url.searchParams.delete(REFERRAL_PARAM);
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }, []);

  /**
   * A ?space=<id> deep link, captured and stripped on arrival.
   *
   * Public listing pages redirect here (migration 0064). The id is remembered
   * and the parameter removed immediately, so it never lingers in history or
   * re-fires on a later navigation. It is also persisted with a short TTL,
   * because a signed-out arrival that signs in with a provider leaves the app
   * entirely (OAuth redirects to /auth/callback), and the in-mount ref alone
   * would not survive that reload — on the way back there is no ?space in the
   * URL, so the persisted intent is restored instead. The same-mount email-code
   * flow keeps working straight from the ref. Only the space param is removed;
   * ?ref, ?pro and ?identity on the same link are left untouched.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const fromUrl = readSpaceDeepLink(url.search);
    if (fromUrl) {
      pendingSpaceRef.current = fromUrl;
      writePendingSpace(fromUrl);
      url.searchParams.delete(SPACE_DEEP_LINK_PARAM);
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
      return;
    }
    // No parameter on this load — but an OAuth round trip strips it before the
    // full redirect, so restore the intent persisted across that reload if it is
    // still fresh.
    const persisted = readPendingSpace();
    if (persisted) pendingSpaceRef.current = persisted;
  }, []);

  /**
   * Open the deep-linked listing once there is an account and a catalogue.
   *
   * Runs when the signed-in data lands — after sign-in for a signed-out arrival,
   * or on resume for a returning one. The id is matched only against listings
   * already loaded for this user: the public catalogue, or their own listings.
   * A removed, unlisted or inaccessible one matches nothing, opens nothing, and
   * leaves them on Discover — no anonymous lookup, no way to probe what exists,
   * no crash. Fires at most once, and the role guard below still decides whether
   * a host may see a practitioner's Detail at all.
   */
  useEffect(() => {
    if (!data || spaceDeepLinkConsumedRef.current) return;
    const id = pendingSpaceRef.current;
    if (!id) return;

    spaceDeepLinkConsumedRef.current = true;
    pendingSpaceRef.current = null;
    // Consumed once, however it resolves — so it never reopens on a later reload.
    clearPendingSpace();

    const open = resolveSpaceDeepLink(id, [data.spaces, data.mySpaces]);
    if (!open) return;

    setActiveSpaceId(open);
    go("detail");
  }, [data, go, setActiveSpaceId]);

  /**
   * Lock the attribution once there is an account to attribute.
   *
   * The code is kept until the server has actually processed it — an attribution
   * or a safe no-op both clear it, but a transient failure keeps it so a later
   * load retries, and it is bound to this account so a different person signing
   * in on the same device can never inherit it. All the anti-abuse itself is the
   * server's; this only has to deliver the code without losing or misplacing it.
   */
  useEffect(() => {
    if (referralAttributedRef.current || !data || typeof window === "undefined") return;
    referralAttributedRef.current = true;
    void runAttribution({
      read: readPendingReferral,
      write: writePendingReferral,
      clear: clearPendingReferral,
      currentUserId: data.profile.id,
      attribute: (code) => repo.attributeReferral(code),
    }).then((outcome) => {
      // Kept means a transient failure — let a later data load try once more.
      if (outcome === "kept") referralAttributedRef.current = false;
    });
  }, [data, repo]);

  /**
   * Returning from Stripe Identity in the native shell — no URL marker, so a
   * resume after a check was started, while still unverified, is the signal to
   * confirm. Guarded by the ref so ordinary backgrounding never triggers it.
   */
  useEffect(() => {
    if (typeof document === "undefined") return;

    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        identityStartedRef.current &&
        !data?.profile.identityVerifiedAt
      ) {
        identityStartedRef.current = false;
        void confirmIdentityVerification();
      }
    };

    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [data?.profile.identityVerifiedAt, confirmIdentityVerification]);

  /**
   * Drop every scrap of the signed-in account from memory and return to the auth
   * entry. `data` is the main snapshot, but sibling state holds user-specific
   * content too — most sensitively `thread` (private message bodies), whose load
   * effect is keyed on threadBookingId and so never clears itself once reset()
   * nulls that id. The SPA is not reloaded on logout (nor in the Capacitor
   * shell), so anything left here would render into the next account on the same
   * mounted tree. Clear it all explicitly.
   */
  const clearSession = useCallback(() => {
    setData(null);
    setThread([]);
    setDisputes([]);
    setCoverageInterest([]);
    setHere(null);
    setNearbyOrder(null);
    setDistanceLabels({});
    reset();
    refresh();
  }, [reset, refresh]);

  /**
   * Deletes, then resets. The order matters only in that the reset must not
   * happen first: a screen re-rendering against an account that still exists
   * would refetch it and look like nothing happened. The account is gone
   * server-side once the API returns ok, so a failed revoke afterwards is moot —
   * clear locally regardless.
   */
  const deleteAccount = useCallback(async () => {
    const response = await apiFetch("/api/account/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "DELETE" }),
    });

    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not delete the account");

    clearSession();
    await repo.signOut().catch(() => {});
  }, [repo, clearSession]);

  const signOut = useCallback(() => {
    // Clear locally FIRST so logout is instant and user A's data can never linger
    // on a flaky connection — the old code awaited repo.signOut() before
    // clearing, so a network failure swallowed the whole cleanup and left A on
    // screen with a live session. Revoke after, surfacing any failure so the
    // person knows the sign-out did not fully complete rather than it failing
    // silently.
    clearSession();
    void repo.signOut().catch((error) => setAuthError(describeAuthError(error)));
  }, [repo, clearSession]);

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
          onPassword={(value, password) => {
            // Reached only for the reviewer address, and only the screen decides
            // that (lib/reviewer-login.ts). Password sign-in resolves in one
            // step — there is no code screen after it — so this both signs in
            // and lands the account, the way verifyEmailCode does above.
            setEmail(value);
            setAuthError(null);

            if (!onSupabase) {
              // Mock mode has no auth server to check a password against; behave
              // like the code flow and let the in-memory repository take over.
              void mutate(() => repo.updateProfile({ email: value }));
              go("role");
              return;
            }

            setAuthBusy(true);
            void (async () => {
              try {
                await signInWithPassword(value, password);
                await ensureProfile();
                refresh();
                go("discover");
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
            //
            // Guarded against a double-tap: the ref rejects a second tap while
            // the first is still opening the browser (the window where two
            // Browser.open calls could race), and busy disables the buttons for
            // that moment. Once the system browser is open the app is
            // backgrounded, so releasing here is safe — a cancel or callback
            // return finds the guard already clear and can retry.
            if (oauthInFlightRef.current) return;
            oauthInFlightRef.current = true;
            setAuthBusy(true);
            void (async () => {
              try {
                await signInWithProvider(provider);
              } catch (error) {
                setAuthError(describeAuthError(error));
              } finally {
                oauthInFlightRef.current = false;
                setAuthBusy(false);
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
    unreadCounts,
    workPreferences,
    workAvailability,
    workOpportunities,
    classTemplates,
    coverageRequests,
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
          onGoWork={() => go("work")}
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
          onRequestSpace={(input) => repo.requestSpace(input)}
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
          onGoWork={() => go("work")}
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
          /*
           * Founding and achievements: the host's own number (null unless they
           * are one of the fifty), the real count of spots still open, and their
           * completed-session total — all from the server. sessionsHosted is
           * already the completed-and-paid count hostFactsFrom made honest.
           */
          foundingNumber={profile.foundingNumber}
          studioProActive={entitlements.studioProActive}
          foundingRemaining={data.foundingRemaining}
          completedSessions={hostFacts.sessionsHosted}
          referralCode={data.referralCode}
          referrals={data.referrals}
          unreadFor={(id) => unreadCounts[id] ?? 0}
        />
  );

  /* ---------------- Work ---------------- */

  // The same person-level gate the booking side uses, so "matchable" reads the
  // same as "bookable". Computed from stored, server-written columns.
  const workEligible = workEligibility(
    {
      accountType: profile.accountType,
      profession: profile.profession,
      identityVerified: profile.identityVerifiedAt !== null,
      credentialVerified: profile.credentialReview.state === "verified",
      insurance: {
        hasCertificate: profile.insuranceDocName !== null,
        state: profile.insuranceReview.state,
        effectiveDate: profile.insuranceEffectiveDate,
        expiresAt: profile.insuranceExpiresAt,
      },
      cancellations,
    },
    now,
  );

  // The one entitlement object the Work UI consumes, from the same pure function
  // and the same server-written columns the API routes re-check. The UI is a
  // mirror; the server is the authority, so a stale client can never grant access.
  const entitlements = entitlementsFor({
    accountType: profile.accountType,
    isPro: profile.isPro,
    studioProSubscription: profile.studioPro,
    foundingHostAt: profile.foundingHostAt,
    foundingPractitionerAt: profile.foundingPractitionerAt,
    foundingHostDiscountForfeitedAt: profile.foundingHostDiscountForfeitedAt,
    foundingPractitionerDiscountForfeitedAt: profile.foundingPractitionerDiscountForfeitedAt,
    work: workEligible,
    now,
  });

  const fixWorkGap = (gap: WorkEligibilityGap) => {
    if (gap === "identity") go("verify");
    else if (gap === "credential") go("credential");
    else go("practitioner-profile");
  };

  const activeCoverage = coverageRequests.find((r) => r.id === activeCoverageId) ?? null;

  const renderWork = () =>
    profile.accountType === "host" ? (
      <WorkStudio
        canPost={entitlements.canPostCoverage}
        studioProActive={entitlements.studioProActive}
        foundingFreeUntil={entitlements.foundingFreeUntil}
        now={now}
        requests={coverageRequests}
        templateCount={classTemplates.length}
        rosterCount={data.roster.length}
        hasSpaces={mySpaces.length > 0}
        onNewCoverage={() => {
          setDuplicateSource(null);
          go("coverage-post");
        }}
        onOpenTemplates={() => go("class-templates")}
        onOpenRoster={() => go("roster")}
        onOpenRequest={(id) => {
          setActiveCoverageId(id);
          go("coverage-detail");
        }}
        onGoStudioPro={() => go("studio-pro")}
        onRefresh={onPullRefresh}
        onBack={back}
      />
    ) : (
      <WorkPractitioner
        canBrowse={entitlements.canBrowseWork}
        canApply={entitlements.canApplyToWork}
        practitionerProActive={entitlements.practitionerProActive}
        foundingProFreeUntil={entitlements.foundingProFreeUntil}
        now={now}
        gaps={workEligible.gaps}
        preferences={workPreferences}
        availabilityCount={workAvailability.length}
        opportunities={workOpportunities}
        busyRequestId={workBusyId}
        onGoPro={() => go("pro")}
        onToggleAvailable={() =>
          void mutate(() =>
            repo.updateWorkPreferences({
              availableForWork: !workPreferences.availableForWork,
              workTimeZone: viewerZone(),
            }),
          )
        }
        onEditAvailability={() => go("work-availability")}
        onExpressInterest={(requestId) => {
          setWorkBusyId(requestId);
          void mutate(() => repo.expressWorkInterest(requestId, null)).finally(() =>
            setWorkBusyId(null),
          );
        }}
        onWithdrawInterest={(interestId) => {
          setWorkBusyId(interestId);
          void mutate(() => repo.withdrawWorkInterest(interestId)).finally(() =>
            setWorkBusyId(null),
          );
        }}
        onFixGap={fixWorkGap}
        onRefresh={onPullRefresh}
        onBack={back}
      />
    );

  const renderWorkAvailability = () => (
    <WorkAvailabilityEditor
      initialBlocks={workAvailability}
      preferences={workPreferences}
      saving={workSaving}
      onSave={(blocks, prefs) => {
        setWorkSaving(true);
        void mutate(async () => {
          await repo.setWorkAvailability(blocks);
          await repo.updateWorkPreferences(prefs);
        })
          .then(() => back())
          .finally(() => setWorkSaving(false));
      }}
      onBack={back}
    />
  );

  const renderClassTemplates = () => (
    <ClassTemplates
      templates={classTemplates}
      saving={workSaving}
      onCreate={(input) => {
        setWorkSaving(true);
        void mutate(() => repo.createClassTemplate(input)).finally(() => setWorkSaving(false));
      }}
      onUpdate={(id, input) => {
        setWorkSaving(true);
        void mutate(() => repo.updateClassTemplate(id, input)).finally(() => setWorkSaving(false));
      }}
      onArchive={(id) => void mutate(() => repo.archiveClassTemplate(id))}
      onBack={back}
    />
  );

  const renderCoveragePost = () => (
    <CoveragePost
      spaces={mySpaces.map((s) => ({ id: s.id, name: s.name, timeZone: s.timeZone }))}
      templates={classTemplates}
      saving={workSaving}
      duplicateFrom={duplicateSource}
      onSubmit={(input) => {
        setWorkSaving(true);
        // Return the promise so the form can release its double-tap latch on
        // failure; a success navigates away and clears the repost source.
        return mutate(() => repo.createCoverageRequest(input))
          .then(() => {
            setDuplicateSource(null);
            back();
          })
          .finally(() => setWorkSaving(false));
      }}
      onBack={back}
    />
  );

  const renderCoverageDetail = () => {
    if (!activeCoverage) return renderWork();
    return (
      <CoverageDetail
        request={activeCoverage}
        interest={coverageInterest}
        loadingInterest={loadingInterest}
        busyInterestId={workBusyId}
        cancelling={workSaving}
        canInvite={entitlements.canUseRoster}
        rosterCount={data.roster.length}
        canRepost={entitlements.canPostCoverage}
        onConfirm={(interestId) => {
          if (!activeCoverageId) return;
          setWorkBusyId(interestId);
          void mutate(() => repo.confirmRequestInterest(activeCoverageId, interestId)).finally(() =>
            setWorkBusyId(null),
          );
        }}
        onCancel={() => {
          if (!activeCoverageId) return;
          setWorkSaving(true);
          void mutate(() => repo.cancelCoverageRequest(activeCoverageId))
            .then(() => back())
            .finally(() => setWorkSaving(false));
        }}
        onInviteFromRoster={() => go("roster-invite")}
        onDuplicate={() => {
          setDuplicateSource(activeCoverage);
          go("coverage-post");
        }}
        onBack={back}
      />
    );
  };

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
    "work-availability",
  ];
  const hostOnly: Screen[] = [
    "host",
    "addspace",
    "edit-hours",
    "edit-space",
    "earnings",
    "host-profile",
    "class-templates",
    "coverage-post",
    "coverage-detail",
    "studio-pro",
    "roster",
    "roster-invite",
  ];
  // "work" is intentionally in neither list: both sides have a Work home, and
  // renderWork() below branches on accountType.

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
  // The list first; then the just-created checkout hold it deliberately hides,
  // so payment and confirmation can render a booking that is not yet captured.
  const activeBooking = resolveActiveBooking(bookings, checkoutBooking, activeBookingId);
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
          effectiveDate={profile.insuranceEffectiveDate}
          expiresAt={profile.insuranceExpiresAt}
          onBack={back}
          onContinue={(file) =>
            (file
              ? mutate(() => repo.uploadInsuranceCertificate(file))
              : Promise.resolve()
            ).then(() => go("discover"))
          }
        />
      );

    case "credential":
      return (
        <CredentialUpload
          proofLabel={proofFor(profile.profession).label}
          initialDocName={profile.credentialDocName}
          state={profile.credentialReview.state}
          reviewNote={profile.credentialReviewNote}
          initialType={profile.credentialType}
          initialNumber={profile.credentialNumber}
          initialJurisdiction={profile.credentialJurisdiction}
          onBack={back}
          onSubmit={(file, details) =>
            (file
              ? mutate(() => repo.uploadCredentialCertificate(file, details))
              : Promise.resolve()
            ).then(() => go("discover"))
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
          onVerifyIdentity={() => {
            setInsuranceGate(null);
            // Marked so a native resume knows a check is in flight; the web
            // return uses the ?identity=checking marker instead. Hands off to
            // Stripe's hosted flow (or resolves instantly in the mock); the
            // webhook writes the verified state, nothing here does.
            identityStartedRef.current = true;
            void mutate(() => repo.startIdentityVerification());
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
              const response = await apiFetch("/api/bookings/series", {
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
              // Keep the created row: the next screen needs it, and the refresh
              // below will not bring it back while it is still an unpaid hold.
              setCheckoutBooking(booking);
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
            setCheckoutBooking(null);
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
            const response = await apiFetch(`/api/bookings/${subject.id}/refund`, {
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
            const response = await apiFetch(`/api/bookings/${subject.id}/claim`, {
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

            const response = await apiFetch(url, {
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

      // The same lifecycle rule the server enforces, from the fields this side
      // holds: a practitioner's booking carries approvalState, a host's does not.
      const messageEligibility = mine
        ? { status: mine.status, approvalState: mine.approvalState }
        : { status: (theirs as HostBooking).status };
      const canSend = bookingAcceptsMessages(messageEligibility);
      const disabledReason = messagingDisabledReason(messageEligibility);

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
          canSend={canSend}
          disabledReason={disabledReason}
          onBack={() => {
            setThreadBookingId(null);
            back();
          }}
          onSend={async (body) => {
            const result = await repo.sendMessage(threadBookingId, body);
            refresh();
            return result;
          }}
          onReport={(reason) => repo.reportBooking(threadBookingId, reason)}
          onBlock={async () => {
            await repo.blockBookingParty(threadBookingId);
            // The thread can no longer send after a block; reflect it.
            refresh();
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
          onDone={() => {
            setCheckoutBooking(null);
            go("discover");
          }}
        />
      );

    case "bookings":
      return (
        <MyBookings
          bookings={bookings}
          onRefresh={onPullRefresh}
          accessFor={(spaceId) => access[spaceId] ?? null}
          // The exact street comes off `access`, not the public catalogue: the
          // catalogue no longer carries it (migration 0055), and `access` is
          // the booking-gated flow that reveals it — loaded for every space the
          // practitioner holds a booking on, so a confirmed session still shows
          // the address for sharing with a client.
          addressFor={(spaceId) => access[spaceId]?.addressLine ?? null}
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
          unreadFor={(id) => unreadCounts[id] ?? 0}
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
            const response = await apiFetch("/api/account/change-request", {
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
          foundingRemaining={data.foundingPractitionerRemaining}
          onGoInsurance={() => go("verify")}
          onGoCredential={() => go("credential")}
          onVerifyIdentity={() => {
            identityStartedRef.current = true;
            return mutate(() => repo.startIdentityVerification());
          }}
          identityChecking={confirmingIdentity}
          onSignOut={signOut}
        />
      );

    case "pro":
      return (
        <ProScreen
          isPro={profile.isPro}
          proActive={entitlements.practitionerProActive}
          celebrate={justUpgraded}
          confirming={confirmingPro}
          foundingFreeActive={entitlements.foundingProFreeUntil !== null}
          foundingDiscount={entitlements.foundingProDiscount}
          onBack={() => {
            // Leaving clears the one-time celebration so a later visit does not
            // replay it.
            setJustUpgraded(false);
            setConfirmingPro(false);
            back();
          }}
          onSubscribe={() => {
            // Flag the native return path before checkout opens; the web path
            // uses the ?pro= redirect instead. This only opens checkout — the
            // screen turns Pro only once the server confirms it.
            checkoutStartedRef.current = true;
            return mutate(() => repo.startProSubscription());
          }}
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

    case "work":
      return renderWork();
    case "work-availability":
      return renderWorkAvailability();
    case "class-templates":
      return renderClassTemplates();
    case "coverage-post":
      return renderCoveragePost();
    case "coverage-detail":
      return renderCoverageDetail();
    case "studio-pro":
      return (
        <StudioProScreen
          active={entitlements.studioProActive}
          foundingFreeUntil={entitlements.foundingFreeUntil}
          foundingDiscount={entitlements.foundingStudioDiscount}
          now={now}
          confirming={confirmingStudioPro}
          onBack={() => {
            setConfirmingStudioPro(false);
            back();
          }}
          onSubscribe={() => {
            // Flags the native return path before checkout opens; the web path
            // uses ?studiopro=. Only opens checkout — the screen turns Pro only
            // once the server confirms studio_pro.
            studioProCheckoutStartedRef.current = true;
            return mutate(() => repo.startStudioProSubscription());
          }}
        />
      );
    case "roster":
      return (
        <RosterScreen
          members={data.roster}
          onRemove={(id) => mutate(() => repo.removeFromRoster(id))}
          onRefresh={onPullRefresh}
          onBack={back}
        />
      );
    case "roster-invite": {
      // Invites are for the coverage request the host came from. Without one,
      // there is nothing to invite to — fall back to the board.
      if (!activeCoverageId) return renderWork();
      const reqId = activeCoverageId;
      const invitedForRequest = new Set(
        [...invitedInviteKeys]
          .filter((k) => k.startsWith(`${reqId}:`))
          .map((k) => k.slice(reqId.length + 1)),
      );
      return (
        <RosterScreen
          members={data.roster}
          invite={{
            invitedIds: invitedForRequest,
            busyIds: invitingRosterIds,
            onInvite: (practitionerId) => {
              // Guard with the same pure rule the control renders from: never
              // invite someone already invited, in flight, or unavailable — so a
              // tap that slips through a stale button state still sends nothing.
              const member = data.roster.find((r) => r.practitionerId === practitionerId);
              if (!member) return;
              const control = inviteControlState(
                member,
                invitedForRequest.has(practitionerId),
                invitingRosterIds.has(practitionerId),
              );
              if (!canSendInvite(control)) return;
              setInvitingRosterIds((prev) => new Set(prev).add(practitionerId));
              void mutate(() => repo.inviteFromRoster(reqId, practitionerId))
                .then(() =>
                  setInvitedInviteKeys((prev) => new Set(prev).add(`${reqId}:${practitionerId}`)),
                )
                .finally(() =>
                  setInvitingRosterIds((prev) => {
                    const next = new Set(prev);
                    next.delete(practitionerId);
                    return next;
                  }),
                );
            },
          }}
          onRefresh={onPullRefresh}
          onBack={back}
        />
      );
    }
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
