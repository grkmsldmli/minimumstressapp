"use client";

import type { DirPerson } from "@/lib/admin/directory";

import { MUTED, Muted, Pill, shortDate, TEXT, usd } from "../kit";
import { type Column, DirectoryScreen } from "./DirectoryScreen";

const typeColor: Record<string, string> = {
  host: "#9B8AFB",
  practitioner: "#3B9BE8",
};

const columns: Column<DirPerson>[] = [
  {
    key: "who",
    header: "Person",
    render: (p) => (
      <div>
        <div style={{ color: TEXT }}>{p.displayName ?? "—"}</div>
        <Muted className="text-[11px]">{p.email ?? "no email"}</Muted>
      </div>
    ),
  },
  {
    key: "type",
    header: "Type",
    render: (p) =>
      p.accountType ? (
        <Pill color={typeColor[p.accountType] ?? MUTED}>{p.accountType}</Pill>
      ) : (
        <Muted className="text-[11px]">undecided</Muted>
      ),
  },
  { key: "sessions", header: "Sessions", align: "right", render: (p) => p.sessions.toLocaleString() },
  {
    key: "money",
    header: "Earned / spent",
    align: "right",
    render: (p) => (
      <span>
        {p.earnedCents > 0 ? usd(p.earnedCents) : "—"}
        <Muted className="text-[11px]"> / {p.spentCents > 0 ? usd(p.spentCents) : "—"}</Muted>
      </span>
    ),
  },
  {
    key: "standing",
    header: "Standing",
    render: (p) =>
      p.suspended ? (
        <Pill color="#F2695C">suspended</Pill>
      ) : p.lateCancellations > 0 ? (
        <Pill color="#E8A33D">{p.lateCancellations} late</Pill>
      ) : (
        <Muted className="text-[11px]">clear</Muted>
      ),
  },
  { key: "joined", header: "Joined", align: "right", render: (p) => <Muted className="text-[11px]">{shortDate(p.joinedAt)}</Muted> },
];

export function PeopleScreen() {
  return (
    <DirectoryScreen<DirPerson>
      path="/api/admin/people"
      columns={columns}
      rowKey={(p) => p.id}
      rowHref={(p) => `/admin/people/${p.id}`}
      searchPlaceholder="Search by name, email or id…"
      emptyText="No accounts yet."
      filters={[
        {
          name: "type",
          label: "Account type",
          options: [
            { value: "all", label: "All types" },
            { value: "practitioner", label: "Practitioners" },
            { value: "host", label: "Hosts" },
          ],
        },
      ]}
    />
  );
}
