"use client";

import type { SystemView } from "@/lib/admin/sections";

import { AMBER, CORAL, HealthGrid, LINE, MUTED, Muted, NotInstrumented, PANEL2, Panel, Stat, TEXT, useAdminData } from "../kit";

export function SystemScreen() {
  const { data, error, loading } = useAdminData<SystemView>("/api/admin/system", 30_000);

  if (error) return <p className="font-body text-[13px]" style={{ color: CORAL }}>Could not load: {error}</p>;
  if (loading && !data) return <p className="font-body text-[13px]" style={{ color: MUTED }}>Loading…</p>;
  if (!data) return null;

  const count = (value: number | null | undefined) =>
    value === null || value === undefined
      ? <NotInstrumented label="Unavailable" />
      : value.toLocaleString();

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Health" right={<Muted className="text-[11px]">measured only — no fake greens</Muted>}>
        <HealthGrid items={data.health} />
      </Panel>

      {!data.reportingAvailable && (
        <div className="rounded-xl px-3.5 py-3 font-body text-[12.5px]" style={{ color: AMBER, border: `1px solid rgba(232,163,61,0.4)`, backgroundColor: "rgba(232,163,61,0.08)" }}>
          Reporting data is unavailable. Health probes above are still live; counts and queues below are not being shown as zero.
        </div>
      )}

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <Stat label="Practitioners" value={count(data.counts?.practitioners)} />
        <Stat label="Hosts" value={count(data.counts?.hosts)} />
        <Stat label="Active listings" value={count(data.counts?.activeListings)} />
        <Stat label="Pending review" value={count(data.counts?.pendingListings)} />
        <Stat label="Terms outstanding" value={count(data.termsOutstanding)} sub="pre-terms accounts, not backfilled" />
      </div>

      <Panel title="Notification failures" count={data.failedNotifications?.length}>
        {data.failedNotifications === null ? (
          <NotInstrumented label="Unavailable — reporting query failed" />
        ) : data.failedNotifications.length === 0 ? (
          <p className="font-body text-[12.5px]" style={{ color: "#4ADE80" }}>The outbox is clear.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {data.failedNotifications.map((n) => (
              <div key={n.id} className="rounded-lg px-3 py-2" style={{ backgroundColor: PANEL2, border: `1px solid ${n.givenUp ? "rgba(242,105,92,0.4)" : LINE}` }}>
                <div className="flex items-center justify-between">
                  <span className="font-body text-[12.5px]" style={{ color: TEXT }}>{n.kind} · {n.channel}</span>
                  <span className="font-body text-[11px]" style={{ color: n.givenUp ? CORAL : MUTED }}>
                    {n.givenUp ? "gave up" : `retrying (${n.attempts})`}
                  </span>
                </div>
                {n.lastError && <p className="font-body text-[11px] mt-0.5 truncate" style={{ color: MUTED }}>{n.lastError}</p>}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
