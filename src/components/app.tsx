"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  Booking,
  CreditEntry,
  HostBooking,
  HostSpace,
  Profile,
  PublicSpace,
  SpaceAccessDetails,
} from "@/lib/domain";
import { type CancellationEvent, standingFor } from "@/lib/reliability";
import { supabaseBackendEnabled } from "@/lib/repository-factory";
import {
  ensureProfile,
  sendEmailCode,
  signInWithProvider,
  verifyEmailCode,
} from "@/lib/supabase/auth";

import { useApp } from "./app-state";
import { AddSpace } from "./screens/add-space";
import { Confirmed, MyBookings } from "./screens/bookings";
import { Discover } from "./screens/discover";
import { EditAvailability, Earnings, HostDashboard, HostProfile } from "./screens/host";
import { Legal } from "./screens/legal";
import { PaymentSheet } from "./screens/payment-sheet";
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
  credit: number;
  ledger: CreditEntry[];
  mySpaces: HostSpace[];
  hostBookings: HostBooking[];
  access: Record<string, SpaceAccessDetails>;
  cancellations: CancellationEvent[];
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
    revision,
    refresh,
  } = useApp();

  const [data, setData] = useState<Snapshot | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  // Read once per render rather than threaded through: it is a build-time
  // constant, and every caller wants the same answer.
  const onSupabase = supabaseBackendEnabled();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [profile, spaces, bookings, credit, ledger, mySpaces, hostBookings, cancellations] =
        await Promise.all([
          repo.getProfile(),
          repo.listPublicSpaces(),
          repo.listMyBookings(),
          repo.getCreditBalanceCents(),
          repo.listCreditEntries(),
          repo.listMySpaces(),
          repo.listHostBookings(),
          repo.listCancellationHistory(),
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
          credit,
          ledger,
          mySpaces,
          hostBookings,
          access,
          cancellations,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [repo, revision]);

  const mutate = useCallback(
    async (action: () => Promise<unknown>) => {
      await action();
      refresh();
    },
    [refresh],
  );

  const signOut = useCallback(() => {
    void (async () => {
      await repo.signOut();
      reset();
      refresh();
    })();
  }, [repo, reset, refresh]);

  if (!data) return <div className="h-full bg-white" />;

  const { profile, spaces, bookings, credit, ledger, mySpaces, hostBookings, access, cancellations } =
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
  const goHosting = () => go(mySpaces.length === 0 ? "addspace" : "host");

  const activeSpace = spaces.find((s) => s.id === activeSpaceId) ?? null;
  const activeBooking = bookings.find((b) => b.id === activeBookingId) ?? null;
  const editingSpace = mySpaces.find((s) => s.id === editingSpaceId) ?? mySpaces[0] ?? null;

  switch (screen) {
    case "splash":
      return <Splash next={() => go("how")} />;

    case "how":
      return <HowItWorks next={() => go("auth-entry")} />;

    case "auth-entry":
      return (
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

    case "auth-verify":
      return (
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

    case "role":
      return <RoleSelect choosePractitioner={() => go("verify")} chooseHost={goHosting} />;

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
      return (
        <Discover
          spaces={spaces}
          isPro={profile.isPro}
          greetingName={profile.displayName}
          onOpenSpace={(spaceId) => {
            setActiveSpaceId(spaceId);
            go("detail");
          }}
          onGoHost={goHosting}
          onGoPro={() => go("pro")}
          onGoBookings={() => go("bookings")}
          onGoProfile={() => go("practitioner-profile")}
          onGoLegal={() => go("legal")}
        />
      );

    case "detail":
      if (!activeSpace) return <Fallback onBack={() => go("discover")} />;
      return (
        <SpaceDetail
          space={activeSpace}
          isPro={profile.isPro}
          creditBalanceCents={credit}
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
          creditBalanceCents={credit}
          creditEntries={ledger}
          accessFor={(spaceId) => access[spaceId] ?? null}
          standing={practitionerStanding}
          onBack={back}
          onCancel={(id) => void mutate(() => repo.cancelBooking(id, "practitioner"))}
          onSimulateHostCancel={(id) => void mutate(() => repo.cancelBooking(id, "host"))}
        />
      );

    case "practitioner-profile":
      return (
        <PractitionerProfile
          profile={profile}
          bookingsCount={bookings.length}
          creditBalanceCents={credit}
          standing={practitionerStanding}
          onBack={back}
          onUpdate={(patch) => void mutate(() => repo.updateProfile(patch))}
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
      return (
        <HostDashboard
          spaces={mySpaces}
          bookings={hostBookings}
          onBack={() => go("discover")}
          onAddSpace={() => go("addspace")}
          onApprove={(spaceId) => void mutate(() => repo.approveSpace(spaceId))}
          onEditHours={(spaceId) => {
            setEditingSpaceId(spaceId);
            go("edit-hours");
          }}
          onOpenEarnings={() => go("earnings")}
          onOpenProfile={() => go("host-profile")}
          onSimulateBooking={(spaceId) =>
            void mutate(() => repo.simulateInboundBooking(spaceId))
          }
        />
      );

    case "addspace":
      return (
        <AddSpace
          onBack={() => go("host")}
          onListed={async (input) => {
            await repo.createSpace(input);
            refresh();
          }}
        />
      );

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

    case "earnings":
      return <Earnings spaces={mySpaces} bookings={hostBookings} onBack={back} />;

    case "host-profile":
      return (
        <HostProfile
          profile={profile}
          spaces={mySpaces}
          standing={hostStanding}
          onBack={back}
          onUpdate={(patch) => void mutate(() => repo.updateProfile(patch))}
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
      <p className="font-body font-light text-[13px] text-ink-soft">
        That page needs something we couldn&apos;t find.
      </p>
      <button
        type="button"
        onClick={onBack}
        className="px-6 py-3 rounded-full font-body font-medium text-[13px] text-white press"
        style={{ backgroundColor: "#3B9BE8" }}
      >
        Go back
      </button>
    </div>
  );
}
