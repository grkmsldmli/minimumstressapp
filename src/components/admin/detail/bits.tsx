"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import type { DirBooking, DirSpace } from "@/lib/admin/directory";

import { dateTime, LINE, MUTED, PANEL2, Pill, shortDate, statusColor, TEXT, usd } from "../kit";

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1.5 font-body text-[12.5px] press mb-1" style={{ color: MUTED }}>
      <ArrowLeft size={14} /> {label}
    </Link>
  );
}

/** A single linked entity as a card row — host on a space, either party on a booking. */
export function EntityLinkRow({
  href,
  title,
  subtitle,
  trailing,
}: {
  href: string;
  title: string;
  subtitle?: string;
  trailing?: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 press"
      style={{ backgroundColor: PANEL2, border: `1px solid ${LINE}` }}
    >
      <span className="min-w-0">
        <span className="font-body text-[13px] block truncate" style={{ color: TEXT }}>{title}</span>
        {subtitle && <span className="font-body text-[11px] block truncate" style={{ color: MUTED }}>{subtitle}</span>}
      </span>
      {trailing && <span className="font-body text-[11px] shrink-0" style={{ color: MUTED }}>{trailing}</span>}
    </Link>
  );
}

export function KeyValueGrid({ rows }: { rows: { label: string; value: React.ReactNode }[] }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
      {rows.map((r, i) => (
        <div key={i}>
          <p className="font-body text-[11px] mb-0.5" style={{ color: MUTED }}>{r.label}</p>
          <div className="font-body text-[13px]" style={{ color: TEXT }}>{r.value}</div>
        </div>
      ))}
    </div>
  );
}

/** A compact, linked booking list for a person or space detail. */
export function MiniBookingList({ bookings, empty }: { bookings: DirBooking[]; empty: string }) {
  if (bookings.length === 0) return <p className="font-body text-[12px]" style={{ color: MUTED }}>{empty}</p>;
  return (
    <div className="flex flex-col gap-1.5">
      {bookings.slice(0, 25).map((b) => (
        <Link
          key={b.id}
          href={`/admin/bookings/${b.id}`}
          className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 press"
          style={{ backgroundColor: PANEL2, border: `1px solid ${LINE}` }}
        >
          <span className="font-body text-[12.5px] min-w-0 truncate" style={{ color: TEXT }}>
            {dateTime(b.startsAt)} · {b.spaceName}
          </span>
          <span className="flex items-center gap-2 shrink-0">
            <Pill color={statusColor(b.status)}>{b.status.replace(/_/g, " ")}</Pill>
            <span className="font-body text-[12px]" style={{ color: MUTED }}>{b.paid ? usd(b.totalCents) : "—"}</span>
          </span>
        </Link>
      ))}
      {bookings.length > 25 && (
        <p className="font-body text-[11px] mt-1" style={{ color: MUTED }}>+ {bookings.length - 25} more</p>
      )}
    </div>
  );
}

/** A compact, linked space list for a host detail. */
export function MiniSpaceList({ spaces, empty }: { spaces: DirSpace[]; empty: string }) {
  if (spaces.length === 0) return <p className="font-body text-[12px]" style={{ color: MUTED }}>{empty}</p>;
  return (
    <div className="flex flex-col gap-1.5">
      {spaces.map((s) => (
        <Link
          key={s.id}
          href={`/admin/spaces/${s.id}`}
          className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 press"
          style={{ backgroundColor: PANEL2, border: `1px solid ${LINE}` }}
        >
          <span className="font-body text-[12.5px] min-w-0 truncate" style={{ color: TEXT }}>{s.name}</span>
          <span className="flex items-center gap-2 shrink-0">
            <Pill color={statusColor(s.status)}>{s.status}</Pill>
            <span className="font-body text-[12px]" style={{ color: MUTED }}>{s.sessions} sess · {shortDate(s.createdAt)}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}
