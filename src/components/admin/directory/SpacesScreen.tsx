"use client";

import type { DirSpace } from "@/lib/admin/directory";

import { Muted, Pill, shortDate, statusColor, TEXT, usd } from "../kit";
import { type Column, DirectoryScreen } from "./DirectoryScreen";

const columns: Column<DirSpace>[] = [
  {
    key: "space",
    header: "Space",
    render: (s) => (
      <div>
        <div style={{ color: TEXT }}>{s.name}</div>
        <Muted className="text-[11px]">{s.addressLine ?? "no address"}</Muted>
      </div>
    ),
  },
  { key: "status", header: "Status", render: (s) => <Pill color={statusColor(s.status)}>{s.status}</Pill> },
  {
    key: "host",
    header: "Host",
    render: (s) => (
      <div>
        <div style={{ color: TEXT }}>{s.hostName ?? "—"}</div>
        <Muted className="text-[11px]">{s.hostEmail ?? ""}</Muted>
      </div>
    ),
  },
  { key: "rate", header: "Rate", align: "right", render: (s) => `${usd(s.hourlyRateCents)}/hr` },
  { key: "sessions", header: "Sessions", align: "right", render: (s) => s.sessions.toLocaleString() },
  { key: "earned", header: "Host earned", align: "right", render: (s) => (s.earnedCents > 0 ? usd(s.earnedCents) : "—") },
  { key: "created", header: "Listed", align: "right", render: (s) => <Muted className="text-[11px]">{shortDate(s.createdAt)}</Muted> },
];

export function SpacesScreen() {
  return (
    <DirectoryScreen<DirSpace>
      path="/api/admin/spaces"
      columns={columns}
      rowKey={(s) => s.id}
      rowHref={(s) => `/admin/spaces/${s.id}`}
      searchPlaceholder="Search by name, address or host…"
      emptyText="No spaces yet."
      filters={[
        {
          name: "status",
          label: "Status",
          options: [
            { value: "all", label: "All statuses" },
            { value: "active", label: "Active" },
            { value: "pending", label: "Pending review" },
            { value: "archived", label: "Archived" },
            { value: "delisted", label: "Delisted" },
          ],
        },
      ]}
    />
  );
}
