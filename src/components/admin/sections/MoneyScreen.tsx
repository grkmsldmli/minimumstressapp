"use client";

import Link from "next/link";

import type { MoneyView } from "@/lib/admin/sections";

import { CORAL, GREEN, MUTED, Muted, PANEL2, Panel, SKY, Stat, TEXT, usd, useAdminData } from "../kit";

export function MoneyScreen() {
  const { data, error, loading } = useAdminData<MoneyView>("/api/admin/money", 30_000);

  if (error) return <p className="font-body text-[13px]" style={{ color: CORAL }}>Could not load: {error}</p>;
  if (loading && !data) return <p className="font-body text-[13px]" style={{ color: MUTED }}>Loading…</p>;
  if (!data) return null;

  const maxGross = Math.max(1, ...data.byDay.map((d) => d.grossCents));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <Stat label="Our revenue · this month" value={usd(data.month.platformCents)} strong />
        <Stat label="Booking volume · this month" value={usd(data.month.grossCents)} sub="what practitioners paid — not our revenue" />
        <Stat label="Paid to hosts · this month" value={usd(data.month.hostCents)} />
        <Stat label="Our revenue · all time" value={usd(data.allTime.platformCents)} />
      </div>

      <Panel title="Last 14 days" right={<Muted className="text-[11px]">volume vs our revenue</Muted>}>
        <div className="flex items-end gap-1.5" style={{ height: 120 }}>
          {data.byDay.map((d) => {
            const grossH = (d.grossCents / maxGross) * 100;
            const platH = (d.platformCents / maxGross) * 100;
            return (
              <div key={d.day} className="flex-1 relative h-full" title={`${d.day}: ${usd(d.grossCents)} volume, ${usd(d.platformCents)} ours`}>
                {/* Gross behind, our revenue in front — both from the baseline, never stacked. */}
                <div className="absolute bottom-0 left-0 right-0 rounded-t" style={{ height: `${grossH}%`, minHeight: d.grossCents > 0 ? 2 : 0, backgroundColor: `${SKY}55` }} />
                <div className="absolute bottom-0 left-0 right-0 rounded-t" style={{ height: `${platH}%`, minHeight: d.platformCents > 0 ? 2 : 0, backgroundColor: GREEN }} />
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 mt-2">
          <span className="flex items-center gap-1.5 font-body text-[11px]" style={{ color: MUTED }}>
            <span className="inline-block rounded" style={{ width: 10, height: 10, backgroundColor: `${SKY}55` }} /> Booking volume
          </span>
          <span className="flex items-center gap-1.5 font-body text-[11px]" style={{ color: MUTED }}>
            <span className="inline-block rounded" style={{ width: 10, height: 10, backgroundColor: GREEN }} /> Our revenue
          </span>
        </div>
      </Panel>

      <Panel
        title="Hosts who cannot be paid"
        count={data.unpayableHosts.length}
        right={<Muted className="text-[11px]">{data.hostsUnpaid} sessions awaiting payout</Muted>}
      >
        {data.unpayableHosts.length === 0 ? (
          <p className="font-body text-[12.5px]" style={{ color: GREEN }}>Everyone who earned can be paid.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {data.unpayableHosts.map((h) => (
              <Link
                key={h.id}
                href={`/admin/people/${h.id}`}
                className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 press"
                style={{ backgroundColor: PANEL2, border: `1px solid rgba(242,105,92,0.4)` }}
              >
                <span className="font-body text-[12.5px] min-w-0 truncate" style={{ color: TEXT }}>{h.email ?? h.id}</span>
                <span className="font-body font-semibold text-[12.5px] shrink-0" style={{ color: CORAL }}>
                  {usd(h.owedCents)} · {h.owedSessions} sess
                </span>
              </Link>
            ))}
          </div>
        )}
      </Panel>

      <p className="font-body text-[11px]" style={{ color: MUTED }}>
        Booking volume, host earnings and platform revenue are three distinct figures — the difference between them is our fee, and they are never summed.
      </p>
    </div>
  );
}
