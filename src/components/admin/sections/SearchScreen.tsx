"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { effectiveSpaceStatus, type SearchResults } from "@/lib/admin/projections";

import { CORAL, dateTime, LINE, MUTED, Muted, PANEL2, Panel, Pill, shortDate, statusColor, TEXT, usd, useAdminData } from "../kit";

function Row({ href, title, subtitle, trailing }: { href: string; title: string; subtitle?: string; trailing?: React.ReactNode }) {
  return (
    <Link href={href} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 press" style={{ backgroundColor: PANEL2, border: `1px solid ${LINE}` }}>
      <span className="min-w-0">
        <span className="font-body text-[13px] block truncate" style={{ color: TEXT }}>{title}</span>
        {subtitle && <span className="font-body text-[11px] block truncate" style={{ color: MUTED }}>{subtitle}</span>}
      </span>
      {trailing && <span className="shrink-0">{trailing}</span>}
    </Link>
  );
}

export function SearchScreen() {
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const { data, error, loading } = useAdminData<SearchResults>(`/api/admin/search?q=${encodeURIComponent(q)}`);

  if (q.trim().length < 2) {
    return <p className="font-body text-[13px]" style={{ color: MUTED }}>Type at least two characters to search people, spaces and bookings.</p>;
  }
  if (error) return <p className="font-body text-[13px]" style={{ color: CORAL }}>Could not load: {error}</p>;
  if (loading && !data) return <p className="font-body text-[13px]" style={{ color: MUTED }}>Searching…</p>;
  if (!data) return null;

  const nothing = data.people.length === 0 && data.spaces.length === 0 && data.bookings.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <Muted className="text-[12.5px]">Results for “{data.term}”</Muted>

      {nothing ? (
        <p className="font-body text-[13px] py-6 text-center" style={{ color: MUTED }}>Nothing matched.</p>
      ) : (
        <>
          {data.people.length > 0 && (
            <Panel title="People" count={data.totalPeople}>
              <div className="flex flex-col gap-1.5">
                {data.people.map((p) => (
                  <Row
                    key={p.id}
                    href={`/admin/people/${p.id}`}
                    title={p.displayName ?? p.email ?? p.id}
                    subtitle={p.email ?? undefined}
                    trailing={p.accountType ? <Pill color={p.accountType === "host" ? "#9B8AFB" : "#3B9BE8"}>{p.accountType}</Pill> : undefined}
                  />
                ))}
              </div>
            </Panel>
          )}

          {data.spaces.length > 0 && (
            <Panel title="Spaces" count={data.totalSpaces}>
              <div className="flex flex-col gap-1.5">
                {data.spaces.map((s) => (
                  <Row
                    key={s.id}
                    href={`/admin/spaces/${s.id}`}
                    title={s.name}
                    subtitle={s.hostEmail ?? s.addressLine ?? undefined}
                    trailing={<Pill color={statusColor(effectiveSpaceStatus(s))}>{effectiveSpaceStatus(s)}</Pill>}
                  />
                ))}
              </div>
            </Panel>
          )}

          {data.bookings.length > 0 && (
            <Panel title="Bookings" count={data.totalBookings}>
              <div className="flex flex-col gap-1.5">
                {data.bookings.map((b) => (
                  <Row
                    key={b.id}
                    href={`/admin/bookings/${b.id}`}
                    title={`${b.spaceName} · ${shortDate(b.startsAt)}`}
                    subtitle={`${dateTime(b.startsAt)} · ${b.practitionerName ?? b.practitionerEmail ?? "—"}`}
                    trailing={<span className="font-body text-[12px]" style={{ color: MUTED }}>{b.paid ? usd(b.totalCents) : "—"}</span>}
                  />
                ))}
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
