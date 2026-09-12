"use client";

import type { PersonDetail } from "@/lib/admin/projections";

import { CORAL, MUTED, Muted, Panel, Pill, shortDate, Stat, TEXT, usd, useAdminData } from "../kit";
import { BackLink, KeyValueGrid, MiniBookingList, MiniSpaceList } from "./bits";

const typeColor: Record<string, string> = { host: "#9B8AFB", practitioner: "#3B9BE8" };

export function PersonDetailScreen({ id }: { id: string }) {
  const { data, error, loading } = useAdminData<PersonDetail>(`/api/admin/people/${id}`);

  if (error) {
    return (
      <div>
        <BackLink href="/admin/people" label="People" />
        <p className="font-body text-[13px]" style={{ color: CORAL }}>
          {error === "Not found" ? "No such person." : `Could not load: ${error}`}
        </p>
      </div>
    );
  }
  if (loading && !data) return <p className="font-body text-[13px]" style={{ color: MUTED }}>Loading…</p>;
  if (!data) return null;

  const { person, listings, asPractitioner, asHost } = data;
  const isHost = person.accountType === "host";

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/people" label="People" />
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="font-display italic font-semibold text-[22px]" style={{ color: TEXT }}>
            {person.displayName ?? "Unnamed account"}
          </h1>
          {person.accountType && <Pill color={typeColor[person.accountType] ?? MUTED}>{person.accountType}</Pill>}
          {person.suspended ? (
            <Pill color={CORAL}>suspended</Pill>
          ) : person.lateCancellations > 0 ? (
            <Pill color="#E8A33D">{person.lateCancellations} late cancellations</Pill>
          ) : null}
        </div>
        <Muted className="text-[12.5px]">{person.email ?? "no email"} · joined {shortDate(person.joinedAt)}</Muted>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        <Stat label="Sessions" value={person.sessions.toLocaleString()} />
        {isHost ? (
          <>
            <Stat label="Earned (host)" value={person.earnedCents > 0 ? usd(person.earnedCents) : "—"} strong />
            <Stat label="Listings" value={person.listings.toLocaleString()} />
            <Stat
              label="Payouts"
              value={person.payoutsReady ? "Ready" : "Not set up"}
              tone={person.payoutsReady ? undefined : "muted"}
            />
          </>
        ) : (
          <Stat label="Spent (practitioner)" value={person.spentCents > 0 ? usd(person.spentCents) : "—"} strong />
        )}
      </div>

      <Panel title="Emergency contact">
        {person.emergency.name || person.emergency.phone ? (
          <KeyValueGrid
            rows={[
              { label: "Name", value: person.emergency.name ?? "—" },
              { label: "Phone", value: person.emergency.phone ?? "—" },
              { label: "Relationship", value: person.emergency.relationship ?? "—" },
            ]}
          />
        ) : (
          <p className="font-body text-[12.5px]" style={{ color: "#E8A33D" }}>
            Never provided — the one fact discovered at the worst possible time.
          </p>
        )}
      </Panel>

      {isHost && (
        <Panel title="Listings" count={listings.length}>
          <MiniSpaceList spaces={listings} empty="No listings." />
        </Panel>
      )}

      <Panel title="Sessions booked" count={asPractitioner.length}>
        <MiniBookingList bookings={asPractitioner} empty="No sessions booked." />
      </Panel>

      {isHost && (
        <Panel title="Sessions in their rooms" count={asHost.length}>
          <MiniBookingList bookings={asHost} empty="No sessions run in their rooms yet." />
        </Panel>
      )}
    </div>
  );
}
