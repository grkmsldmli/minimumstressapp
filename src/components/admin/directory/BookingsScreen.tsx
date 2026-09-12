"use client";

import type { DirBooking } from "@/lib/admin/directory";

import { dateTime, Muted, Pill, statusColor, TEXT, usd } from "../kit";
import { type Column, DirectoryScreen } from "./DirectoryScreen";

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
  { key: "status", header: "Status", render: (b) => <Pill color={statusColor(b.status)}>{b.status.replace(/_/g, " ")}</Pill> },
  {
    key: "gross",
    header: "Paid",
    align: "right",
    render: (b) => (b.paid ? usd(b.totalCents) : <Muted className="text-[11px]">unpaid</Muted>),
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
            { value: "completed", label: "Completed" },
            { value: "cancelled_by_practitioner", label: "Cancelled · practitioner" },
            { value: "cancelled_by_host", label: "Cancelled · host" },
          ],
        },
      ]}
    />
  );
}
