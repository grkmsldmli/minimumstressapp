"use client";

import type { DirBooking } from "@/lib/admin/directory";

import { CORAL, dateTime, MUTED, Muted, Panel, Pill, Stat, statusColor, TEXT, usd, useAdminData } from "../kit";
import { BackLink, EntityLinkRow, KeyValueGrid } from "./bits";

function statusLabel(status: string): string {
  if (status === "awaiting_host_approval") return "awaiting host approval";
  return status.replace(/_/g, " ");
}

export function BookingDetailScreen({ id }: { id: string }) {
  const { data, error, loading } = useAdminData<DirBooking>(`/api/admin/bookings/${id}`);

  if (error) {
    return (
      <div>
        <BackLink href="/admin/bookings" label="Bookings" />
        <p className="font-body text-[13px]" style={{ color: CORAL }}>
          {error === "Not found" ? "No such booking." : `Could not load: ${error}`}
        </p>
      </div>
    );
  }
  if (loading && !data) return <p className="font-body text-[13px]" style={{ color: MUTED }}>Loading…</p>;
  if (!data) return null;

  const b = data;
  const awaitingApproval = b.status === "awaiting_host_approval";

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/bookings" label="Bookings" />
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="font-display italic font-semibold text-[22px]" style={{ color: TEXT }}>{b.spaceName}</h1>
          <Pill color={statusColor(b.status)}>{statusLabel(b.status)}</Pill>
        </div>
        <Muted className="text-[12.5px]">{dateTime(b.startsAt)}{b.endsAt ? ` – ${dateTime(b.endsAt)}` : ""}</Muted>
      </div>

      {/* Net figures after any recorded refund. */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        <Stat
          label={awaitingApproval ? "Card authorization" : "Practitioner net paid"}
          value={awaitingApproval ? "Held" : b.paid ? usd(b.totalCents) : "unpaid"}
          tone={!b.paid && !awaitingApproval ? "muted" : undefined}
        />
        <Stat label="Host earnings" value={b.paid ? usd(b.hostRateCents) : "—"} />
        <Stat label="Our net revenue" value={b.paid ? usd(b.platformCents) : "—"} strong />
      </div>

      <Panel title="Parties">
        <div className="flex flex-col gap-2">
          {b.practitionerId ? (
            <EntityLinkRow
              href={`/admin/people/${b.practitionerId}`}
              title={b.practitionerName ?? "Practitioner"}
              subtitle={b.practitionerEmail ?? ""}
              trailing="practitioner"
            />
          ) : (
            <Muted className="text-[12px]">No practitioner on record.</Muted>
          )}
          {b.hostId ? (
            <EntityLinkRow
              href={`/admin/people/${b.hostId}`}
              title={b.hostName ?? "Host"}
              subtitle={b.hostEmail ?? ""}
              trailing="host"
            />
          ) : (
            <Muted className="text-[12px]">No host on record.</Muted>
          )}
          <EntityLinkRow href={`/admin/spaces/${b.spaceId}`} title={b.spaceName} trailing="space" />
        </div>
      </Panel>

      <Panel title="Money & lifecycle">
        <KeyValueGrid
          rows={[
            { label: "Captured", value: b.capturedAt ? dateTime(b.capturedAt) : awaitingApproval ? "authorized, not captured" : <Muted className="text-[12px]">not captured</Muted> },
            { label: "Original charge", value: b.paid ? usd(b.chargedCents) : "—" },
            { label: "Refunded amount", value: b.refundedCents > 0 ? usd(b.refundedCents) : "—" },
            { label: "Net practitioner payment", value: b.paid ? usd(b.totalCents) : "—" },
            { label: "Cancelled", value: b.cancelledAt ? dateTime(b.cancelledAt) : "—" },
            { label: "Refund recorded", value: b.refundedAt ? dateTime(b.refundedAt) : "—" },
            { label: "Host paid out", value: b.hostPaidAt ? dateTime(b.hostPaidAt) : <Muted className="text-[12px]">not yet</Muted> },
          ]}
        />
      </Panel>
    </div>
  );
}
