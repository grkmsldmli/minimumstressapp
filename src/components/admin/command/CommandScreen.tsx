"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";

import type { CommandView } from "@/lib/admin/command";

import {
  AMBER,
  CORAL,
  GREEN,
  LINE,
  MUTED,
  Muted,
  NotInstrumented,
  PANEL2,
  Panel,
  SKY,
  Stat,
  StatusDot,
  TEXT,
  VIOLET,
  useAdminData,
  usd,
} from "../kit";

const ACTIVITY_COLOR: Record<string, string> = {
  signup: GREEN,
  listing: SKY,
  booking: VIOLET,
  cancellation: CORAL,
  review: AMBER,
  message: MUTED,
};

export function CommandScreen() {
  const { data, error, loading } = useAdminData<CommandView>("/api/admin/command", 20_000);

  if (error) {
    return <p className="font-body text-[13px]" style={{ color: CORAL }}>Could not load: {error}</p>;
  }
  if (loading && !data) {
    return <p className="font-body text-[13px]" style={{ color: MUTED }}>Loading…</p>;
  }
  if (!data) return null;

  return (
    <div className="flex flex-col gap-4">
      {/* KPI row — what is happening */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        {data.kpis.map((k) => (
          <Stat
            key={k.key}
            label={k.label}
            strong={k.strong}
            sub={k.sub}
            value={
              k.value === null ? (
                <NotInstrumented />
              ) : k.format === "money" ? (
                usd(k.value)
              ) : (
                k.value.toLocaleString()
              )
            }
          />
        ))}
      </div>

      {/* System status */}
      <Panel title="System status">
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          {data.health.map((h) => (
            <div key={h.key} className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: PANEL2, border: `1px solid ${LINE}` }}>
              <StatusDot state={h.state} />
              <span className="font-body text-[13px]" style={{ color: TEXT }}>{h.label}</span>
              <span className="font-body text-[11px] ml-auto capitalize" style={{ color: MUTED }}>
                {h.note ?? h.state}
              </span>
            </div>
          ))}
        </div>
      </Panel>

      {/* Needs attention — collapses when clear */}
      <Panel title="Needs attention">
        {data.queuesClear ? (
          <div className="flex items-center gap-2 rounded-lg px-3 py-3" style={{ backgroundColor: "rgba(74,222,128,0.1)", border: `1px solid rgba(74,222,128,0.3)` }}>
            <StatusDot state="healthy" />
            <span className="font-body text-[13px]" style={{ color: TEXT }}>
              All clear — {data.queuesTotal} operational queues have no open items.
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {data.needsAttention.map((a) => (
              <Link
                key={a.key}
                href={a.href}
                className="flex items-center justify-between rounded-lg px-3 py-2.5 press"
                style={{
                  backgroundColor: PANEL2,
                  border: `1px solid ${a.tone === "bad" ? "rgba(242,105,92,0.4)" : "rgba(232,163,61,0.4)"}`,
                }}
              >
                <span className="font-body text-[13px]" style={{ color: TEXT }}>{a.label}</span>
                <span className="flex items-center gap-1.5 font-body font-semibold text-[13px]" style={{ color: a.tone === "bad" ? CORAL : AMBER }}>
                  {a.count} <ChevronRight size={14} />
                </span>
              </Link>
            ))}
          </div>
        )}
      </Panel>

      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        {/* In a room now */}
        {data.liveSessions.length > 0 && (
          <Panel title="In a room now" count={data.liveSessions.length}>
            {data.liveSessions.map((s) => (
              <div key={s.bookingId} className="rounded-xl p-3 mb-2 last:mb-0" style={{ backgroundColor: PANEL2, border: `1px solid ${LINE}` }}>
                <div className="flex items-center justify-between">
                  <span className="font-body font-semibold text-[13px]" style={{ color: TEXT }}>{s.spaceName}</span>
                  <span className="font-body text-[11px]" style={{ color: AMBER }}>{s.state}</span>
                </div>
                {s.addressLine && <p className="font-body text-[12px] mt-0.5" style={{ color: MUTED }}>{s.addressLine}</p>}
                <p className="font-body text-[12px] mt-1" style={{ color: MUTED }}>
                  {s.practitioner.name ?? "Practitioner"} · host {s.host.name ?? "—"}
                </p>
              </div>
            ))}
          </Panel>
        )}

        {/* Live activity */}
        <Panel title="Live activity">
          {data.activity.length === 0 ? (
            <Muted className="text-[12px]">Nothing yet.</Muted>
          ) : (
            <div className="flex flex-col gap-1.5">
              {data.activity.map((a) => (
                <div key={a.id} className="flex items-start gap-2">
                  <span className="rounded-full mt-1.5 shrink-0" style={{ width: 7, height: 7, backgroundColor: ACTIVITY_COLOR[a.kind] ?? MUTED }} />
                  <span className="font-body text-[12.5px]" style={{ color: TEXT }}>{a.text}</span>
                  <span className="font-body text-[11px] ml-auto shrink-0" style={{ color: MUTED }}>
                    {new Date(a.at).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
