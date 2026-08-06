"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  Booking,
  HostBooking,
  HostSpace,
  Profile,
  PublicSpace,
  SpaceAccessDetails,
} from "@/lib/domain";
import { type CancellationEvent, standingFor } from "@/lib/reliability";
import type { LocationChoice } from "@/components/location-prompt";
import { supabaseBackendEnabled } from "@/lib/repository-factory";
import {
  ensureProfile,
  sendEmailCode,
  signInWithProvider,
  verifyEmailCode,
} from "@/lib/supabase/auth";

import { type Screen, useApp } from "./app-state";
import { AddSpace } from "./screens/add-space";
import { Confirmed, MyBookings } from "./screens/bookings";
import { Discover } from "./screens/discover";
import { EditSpace } from "./screens/edit-space";
import { EditAvailability, Earnings, HostDashboard, HostProfile } from "./screens/host";
import { Legal } from "./screens/legal";
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

/** Everything the shell reads, refetched whenever the repository changes. */
interface Snapshot {
  profile: Profile;
  spaces: PublicSpace[];
  bookings: Booking[];
  mySpaces: HostSpace[];
  hostBookings: HostBooking[];
  access: Record<string, SpaceAccessDetails>;
  cancellations: CancellationEvent[];
  sessions: number;
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
    setThreadBookingId,
    revision,
    refresh,
  } = useApp();

  const [data, setData] = useState<Snapshot | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  /**
   * Loaded when a thread opens rather than with everything else.
   *
   * A booking list can be long and most of its threads are empty; fetching
   * them all on every refresh would be work nobody asked for. The trade is one
   * request when a thread is actually opened.
   */
  const [thread, setThread] = useState<ThreadMessage[]>([]);

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

  const chooseLocation = useCallback(async (choice: LocationChoice) => {
    setLocationError(null);
    try {
      const query =
        choice.kind === "coords"
          ? `lat=${choice.lat}&lng=${choice.lng}`
          : `postalCode=${encodeURIComponent(choice.postalCode)}`;

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

  // Read once per render rather than threaded through: it is a build-time
  // constant, and every caller wants the same answer.
  const onSupabase = supabaseBackendEnabled();

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

    (async () => {
      const [profile, spaces, bookings, mySpaces, hostBookings, cancellations, sessions] =
        await Promise.all([
          repo.getProfile(),
          repo.listPublicSpaces(),
          repo.listMyBookings(),
          repo.listMySpaces(),
          repo.listHostBookings(),
          repo.listCancellationHistory(),
          repo.getSessionCount(),
        ]);

      // Address details are per-space and authorization-gated, so they are
      // fetched only for spaces the user actually holds a booking on.
      const access: Record<string, SpaceAccessDetails> = {};
      for (const spaceId of new Set(bookings.map((b) => b.spaceId))) {
        const details = await repo.getSpaceAccessDetails(spaceId);
        if (details) access[spaceId] = details;
      }

      if (!cancelled) {
        setData({
          profile,
          spaces,
          bookings,
          mySpaces,
          hostBookings,
          access,
          cancellations,
          sessions,
        });
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
          error={authError}
          busy={authBusy}
          onEmail={(value) => {
            setEmail(value);
            setAuthError(null);

            if (!onSupabase) {
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
                go("role");
              } catch (error) {
                setAuthError(describeAuthError(error));
              } finally {
                setAuthBusy(false);
              }
            })();
          }}
        />
  );

  // Shown from two places: the switch below, and the guard that catches an
  // account which signed in but never answered the question.
  const renderRoleSelect = () => (
        <RoleSelect
          /*
            Written before navigating, and awaited. Landing on a practitioner
            screen while the account is still typeless would show someone a
            side they may not have chosen.
          */
          choosePractitioner={() => {
            void (async () => {
              await repo.updateProfile({ accountType: "practitioner" });
              refresh();
              go("verify");
            })();
          }}
          chooseHost={() => {
            void (async () => {
              await repo.updateProfile({ accountType: "host" });
              refresh();
              go("addspace");
            })();
          }}
        />
  );

  // Rendered before the data guard, because these are exactly the screens that
  // exist to get someone to the point where there is data to load.
  if (screen === "splash") return <Splash next={() => go("how")} />;
  if (screen === "how") return <HowItWorks next={() => go("auth-entry")} />;
  if (screen === "auth-entry") return renderAuthEntry();
  if (screen === "auth-verify") return renderAuthVerify();

  if (!data) return <div className="h-full bg-white" />;

  const { profile, spaces, bookings, mySpaces, hostBookings, access, cancellations, sessions } =
    data;

  // One history, read from each side. The same function answers "how do I
  // stand" on both profiles, so the two can never disagree about a shared
  // cancellation.
  const now = new Date();
  const practitionerStanding = standingFor("practitioner", cancellations, now);
  const hostStanding = standingFor("host", cancellations, now);

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

  // Both are rendered from the switch below and from the guard above it, so
  // they are functions rather than inline cases.
  const renderAddSpace = () => (
        <AddSpace
          onBack={() => go("host")}
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
          greetingName={profile.displayName}
          onOpenSpace={(spaceId) => {
            setActiveSpaceId(spaceId);
            go("detail");
          }}
          onGoPro={() => go("pro")}
          onGoBookings={() => go("bookings")}
          onGoProfile={() => go("practitioner-profile")}
          onGoLegal={() => go("legal")}
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
          onBack={() => go("discover")}
          onAddSpace={() => go("addspace")}
          onEditHours={(spaceId) => {
            setEditingSpaceId(spaceId);
            go("edit-hours");
          }}
          onEditSpace={(spaceId) => {
            setEditingSpaceId(spaceId);
            go("edit-space");
          }}
          onOpenEarnings={() => go("earnings")}
          onOpenProfile={() => go("host-profile")}
          onReviewBooking={(bookingId) => {
            setReviewing({ bookingId, role: "host" });
            go("review");
          }}
          onMessageBooking={(bookingId) => {
            setThreadBookingId(bookingId);
            go("thread");
          }}
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

  if (profile.accountType === "host" && practitionerOnly.includes(screen)) {
    return hostLanding();
  }
  if (profile.accountType === "practitioner" && hostOnly.includes(screen)) {
    return renderDiscover();
  }

  const activeSpace = spaces.find((s) => s.id === activeSpaceId) ?? null;
  const activeBooking = bookings.find((b) => b.id === activeBookingId) ?? null;
  const editingSpace = mySpaces.find((s) => s.id === editingSpaceId) ?? mySpaces[0] ?? null;

  switch (screen) {
    case "role":
      return renderRoleSelect();

    case "verify":
      return (
        <InsuranceUpload
          initialDocName={profile.insuranceDocName}
          onContinue={(docName) => {
            void mutate(() => repo.updateProfile({ insuranceDocName: docName }));
            go("discover");
          }}
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
          onBack={back}
          onGoPro={() => go("pro")}
          onBook={(startsAt) => {
            void (async () => {
              const { booking, clientSecret } = await repo.createBooking({
                spaceId: activeSpace.id,
                startsAt,
              });
              setActiveBookingId(booking.id);
              setClientSecret(clientSecret);
              refresh();
              // The booking row exists either way. A clientSecret means a card
              // still has to be confirmed against it; without one there is
              // nothing left to do and the payment screen would be a lie.
              go(clientSecret ? "payment" : "confirmed");
            })();
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
          when={subject.startsAt.toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          })}
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
          accessFor={(spaceId) => access[spaceId] ?? null}
          standing={practitionerStanding}
          onBack={back}
          onCancel={(id) => void mutate(() => repo.cancelBooking(id, "practitioner"))}
          onReview={(id) => {
            setReviewing({ bookingId: id, role: "practitioner" });
            go("review");
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
          sessions={sessions}
          onDeleteAccount={deleteAccount}
          bookingsCount={bookings.length}
          standing={practitionerStanding}
          onBack={back}
          onUpdate={(patch) => mutate(() => repo.updateProfile(patch))}
          onPickAvatar={(file) => mutate(() => repo.uploadAvatar(file))}
          onGoLegal={() => go("legal")}
          onGoInsurance={() => go("verify")}
          onSignOut={signOut}
        />
      );

    case "pro":
      return (
        <ProScreen
          isPro={profile.isPro}
          onBack={back}
          onSubscribe={() => void mutate(() => repo.startProSubscription())}
        />
      );

    case "legal":
      return <Legal onBack={back} />;

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
            void mutate(() => repo.updateSpaceAvailability(editingSpace.id, blocks))
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
        />
      );
    }

    case "earnings":
      return <Earnings spaces={mySpaces} bookings={hostBookings} onBack={back} />;

    case "host-profile":
      return (
        <HostProfile
          profile={profile}
          sessions={sessions}
          onDeleteAccount={deleteAccount}
          spaces={mySpaces}
          standing={hostStanding}
          onBack={back}
          onUpdate={(patch) => mutate(() => repo.updateProfile(patch))}
          onPickAvatar={(file) => mutate(() => repo.uploadAvatar(file))}
          onGoLegal={() => go("legal")}
          onConnectPayouts={() => void mutate(() => repo.connectPayouts())}
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
