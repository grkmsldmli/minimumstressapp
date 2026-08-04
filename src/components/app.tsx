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

import { useApp } from "./app-state";
import { AddSpace } from "./screens/add-space";
import { Confirmed, MyBookings } from "./screens/bookings";
import { Discover } from "./screens/discover";
import { EditAvailability, Earnings, HostDashboard, HostProfile } from "./screens/host";
import { Legal } from "./screens/legal";
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
    revision,
    refresh,
  } = useApp();

  const [data, setData] = useState<Snapshot | null>(null);

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
          onEmail={(value) => {
            setEmail(value);
            void mutate(() => repo.updateProfile({ email: value }));
            go("auth-verify");
          }}
          onProvider={(provider) => {
            const label = provider === "apple" ? "Apple ID" : "Google account";
            setEmail(label);
            void mutate(() => repo.updateProfile({ email: label }));
            go("role");
          }}
        />
      );

    case "auth-verify":
      return <AuthVerify email={email} next={() => go("role")} />;
    // The code itself is ignored while the mock repository is in play — see
    // src/lib/repository-factory.ts for why, and for where the real
    // verifyEmailCode call takes over.

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
              const booking = await repo.createBooking({ spaceId: activeSpace.id, startsAt });
              setActiveBookingId(booking.id);
              refresh();
              go("confirmed");
            })();
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
