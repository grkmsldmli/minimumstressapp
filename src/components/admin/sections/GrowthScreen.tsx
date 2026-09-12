"use client";

import type { GrowthView } from "@/lib/admin/growth";

import { CORAL, LINE, MUTED, Muted, NotInstrumented, PANEL2, Panel, SKY, Stat, TEXT, useAdminData } from "../kit";

export function GrowthScreen() {
  const { data, error, loading } = useAdminData<GrowthView>("/api/admin/growth", 60_000);

  if (error) return <p className="font-body text-[13px]" style={{ color: CORAL }}>Could not load: {error}</p>;
  if (loading && !data) return <p className="font-body text-[13px]" style={{ color: MUTED }}>Loading…</p>;
  if (!data) return null;

  const top = Math.max(1, ...data.funnel.map((s) => s.count));

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Funnel" right={<Muted className="text-[11px]">live, from real rows</Muted>}>
        <div className="flex flex-col gap-2">
          {data.funnel.map((step) => (
            <div key={step.label} className="flex items-center gap-3">
              <span className="font-body text-[12.5px] w-40 shrink-0" style={{ color: TEXT }}>{step.label}</span>
              <div className="flex-1 rounded-full overflow-hidden" style={{ backgroundColor: PANEL2, height: 18 }}>
                <div className="h-full rounded-full" style={{ width: `${(step.count / top) * 100}%`, backgroundColor: SKY, minWidth: step.count > 0 ? 4 : 0 }} />
              </div>
              <span className="font-body font-semibold text-[12.5px] w-12 text-right shrink-0" style={{ color: TEXT }}>{step.count}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title={`Product events · last ${data.windowDays} days`}>
        {data.instrumented ? (
          <>
            <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
              <Stat label="Events" value={data.events.total.toLocaleString()} />
              <Stat label="Distinct sessions" value={data.events.distinctSessions.toLocaleString()} />
              <Stat label="Distinct users" value={data.events.distinctUsers.toLocaleString()} />
            </div>
            <div className="flex flex-col gap-1.5">
              {data.events.byName.map((e) => (
                <div key={e.name} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ backgroundColor: PANEL2, border: `1px solid ${LINE}` }}>
                  <span className="font-body text-[12.5px]" style={{ color: TEXT }}>{e.name}</span>
                  <span className="font-body font-semibold text-[12.5px]" style={{ color: MUTED }}>{e.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="font-body text-[12.5px]" style={{ color: MUTED }}>
            No product events recorded yet. The event stream exists (migration 0073); server-side
            instrumentation is being rolled out, so this fills in as real events land — it is
            deliberately not seeded with fake numbers.
          </p>
        )}
      </Panel>

      <Panel title="Not instrumented yet">
        <div className="flex flex-col gap-1.5">
          {data.notInstrumented.map((label) => (
            <div key={label} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ backgroundColor: PANEL2, border: `1px solid ${LINE}` }}>
              <span className="font-body text-[12.5px]" style={{ color: TEXT }}>{label}</span>
              <NotInstrumented />
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
