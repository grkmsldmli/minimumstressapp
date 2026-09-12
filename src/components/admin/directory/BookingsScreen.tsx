"use client";

import type { DirBooking } from "@/lib/admin/directory";

import { dateTime, Muted, Pill, statusColor, TEXT, usd } from "../kit";
import { type Column, DirectoryScreen } from "./DirectoryScreen";

function bookingStatusLabel(status: string): string {
  if (status === "awaiting_host_approval") return "awaiting host approval";
  return status.replace(/_/g, " ");
}

const columns: Column<DirBooking>[] = [
  {
    key: "when",
    header: "When",
    render: (b) => <span style={{ color: TEXT }}>{dateTime(b.startsAt)}</span>,
  },
  {
    key: "space",
    header: "Space",
    render: (b) => <span style={{ color: TEXT }}>{b.spaceName}</span>,
  },
  {
    key: "practitioner",
    header: "Practitioner",
    render: (b) => <span style={{ color: TEXT }}>{b.practitionerName ?? b.practitionerEmail ?? "—"}</span>,
  },
  { key: "status", header: "Status", render: (b) => <Pill color={statusColor(b.status)}>{bookingStatusLabel(b.status)}</Pill> },
  {
    key: "gross",
    header: "Paid",
    align: "right",
    render: (b) =>
      b.paid ? (
        usd(b.totalCents)
      ) : b.status === "awaiting_host_approval" ? (
        <Muted className="text-[11px]">authorized</Muted>
      ) : (
        <Muted className="text-[11px]">unpaid</Muted>
      ),
  },
  { key: "platform", header: "Our fee", align: "right", render: (b) => (b.paid ? usd(b.platformCents) : "—") },
];

export function BookingsScreen() {
  return (
    <DirectoryScreen<DirBooking>
      path="/api/admin/bookings"
      columns={columns}
      rowKey={(b) => b.id}
      rowHref={(b) => `/admin/bookings/${b.id}`}
      searchPlaceholder="Search by space, practitioner or host…"
      emptyText="No bookings yet."
      filters={[
        {
          name: "status",
          label: "Status",
          options: [
            { value: "all", label: "All statuses" },
            { value: "upcoming", label: "Upcoming" },
            { value: "awaiting_host_approval", label: "Awaiting host approval" },
            { value: "completed", label: "Completed" },
            { value: "cancelled_by_practitioner", label: "Cancelled · practitioner" },
            { value: "cancelled_by_host", label: "Cancelled · host" },
          ],
        },
      ]}
    />
  );
}
