"use client";

import type { SystemView } from "@/lib/admin/sections";

import { CORAL, LINE, MUTED, Muted, PANEL2, Panel, Stat, StatusDot, TEXT, useAdminData } from "../kit";

export function SystemScreen() {
  const { data, error, loading } = useAdminData<SystemView>("/api/admin/system", 30_000);

  if (error) return <p className="font-body text-[13px]" style={{ color: CORAL }}>Could not load: {error}</p>;
  if (loading && !data) return <p className="font-body text-[13px]" style={{ color: MUTED }}>Loading…</p>;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Health" right={<Muted className="text-[11px]">measured only — no fake greens</Muted>}>
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          {data.health.map((h) => (
            <div key={h.key} className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: PANEL2, border: `1px solid ${LINE}` }}>
              <StatusDot state={h.state} />
              <span className="font-body text-[13px]" style={{ color: TEXT }}>{h.label}</span>
              <span className="font-body text-[11px] ml-auto capitalize" style={{ color: MUTED }}>{h.note ?? h.state}</span>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <Stat label="Practitioners" value={data.counts.practitioners.toLocaleString()} />
        <Stat label="Hosts" value={data.counts.hosts.toLocaleString()} />
        <Stat label="Active listings" value={data.counts.activeListings.toLocaleString()} />
        <Stat label="Pending review" value={data.counts.pendingListings.toLocaleString()} />
        <Stat label="Terms outstanding" value={data.termsOutstanding.toLocaleString()} sub="pre-terms accounts, not backfilled" />
      </div>

      <Panel title="Notification failures" count={data.failedNotifications.length}>
        {data.failedNotifications.length === 0 ? (
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
