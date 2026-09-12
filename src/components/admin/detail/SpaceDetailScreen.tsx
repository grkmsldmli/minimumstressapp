"use client";

import type { SpaceDetail } from "@/lib/admin/projections";

import { CORAL, MUTED, Muted, Panel, Pill, shortDate, Stat, statusColor, TEXT, usd, useAdminData } from "../kit";
import { BackLink, EntityLinkRow, MiniBookingList } from "./bits";

export function SpaceDetailScreen({ id }: { id: string }) {
  const { data, error, loading } = useAdminData<SpaceDetail>(`/api/admin/spaces/${id}`);

  if (error) {
    return (
      <div>
        <BackLink href="/admin/spaces" label="Spaces" />
        <p className="font-body text-[13px]" style={{ color: CORAL }}>
          {error === "Not found" ? "No such space." : `Could not load: ${error}`}
        </p>
      </div>
    );
  }
  if (loading && !data) return <p className="font-body text-[13px]" style={{ color: MUTED }}>Loading…</p>;
  if (!data) return null;

  const { space, bookings } = data;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/spaces" label="Spaces" />
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="font-display italic font-semibold text-[22px]" style={{ color: TEXT }}>{space.name}</h1>
          <Pill color={statusColor(space.status)}>{space.status}</Pill>
        </div>
        <Muted className="text-[12.5px]">{space.addressLine ?? "no address"} · listed {shortDate(space.createdAt)}</Muted>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        <Stat label="Rate" value={`${usd(space.hourlyRateCents)}/hr`} />
        <Stat label="Sessions" value={space.sessions.toLocaleString()} />
        <Stat label="Host earned" value={space.earnedCents > 0 ? usd(space.earnedCents) : "—"} strong />
        <Stat label="Category" value={space.category || "—"} />
      </div>

      <Panel title="Host">
        {space.hostId ? (
          <EntityLinkRow
            href={`/admin/people/${space.hostId}`}
            title={space.hostName ?? "Host"}
            subtitle={space.hostEmail ?? ""}
            trailing={space.archivedAt ? `archived ${shortDate(space.archivedAt)}` : undefined}
          />
        ) : (
          <Muted className="text-[12.5px]">No host on record.</Muted>
        )}
      </Panel>

      <Panel title="Bookings" count={bookings.length}>
        <MiniBookingList bookings={bookings} empty="No bookings for this space yet." />
      </Panel>
    </div>
  );
}
