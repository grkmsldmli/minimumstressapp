"use client";

import Link from "next/link";

import type { WorkView } from "@/lib/admin/work-view";

import { AMBER, CORAL, dateTime, LINE, MUTED, Muted, PANEL2, Panel, Pill, Stat, TEXT, usd, useAdminData } from "../kit";

export function WorkScreen() {
  const { data, error, loading } = useAdminData<WorkView>("/api/admin/work", 30_000);

  if (error) return <p className="font-body text-[13px]" style={{ color: CORAL }}>Could not load: {error}</p>;
  if (loading && !data) return <p className="font-body text-[13px]" style={{ color: MUTED }}>Loading…</p>;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
        <Stat label="Open requests" value={data.counts.open.toLocaleString()} strong />
        <Stat label="Urgent & open" value={data.counts.urgentOpen.toLocaleString()} tone={data.counts.urgentOpen > 0 ? undefined : "muted"} />
        <Stat label="Filled" value={data.counts.filled.toLocaleString()} />
        <Stat label="Completed" value={data.counts.completed.toLocaleString()} />
        <Stat label="Interest offers" value={data.interest.total.toLocaleString()} sub={`${data.interest.confirmed} confirmed`} />
      </div>

      <Panel title="Open & uncovered" count={data.openRequests.length}>
        {data.openRequests.length === 0 ? (
          <p className="font-body text-[12.5px]" style={{ color: MUTED }}>Nothing open on the board right now.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {data.openRequests.map((r) => (
              <div key={r.id} className="rounded-lg px-3 py-2.5" style={{ backgroundColor: PANEL2, border: `1px solid ${r.urgent ? "rgba(232,163,61,0.4)" : LINE}` }}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="font-body text-[13px] truncate" style={{ color: TEXT }}>{r.title}</span>
                    {r.urgent && <Pill color={AMBER}>urgent</Pill>}
                    {r.profession && <Muted className="text-[11px]">{r.profession}</Muted>}
                  </span>
                  <span className="font-body font-semibold text-[12.5px] shrink-0" style={{ color: TEXT }}>{usd(r.payCents)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 mt-1">
                  <span className="font-body text-[11.5px]" style={{ color: MUTED }}>
                    {dateTime(r.startsAt)}
                    {r.hostId && (
                      <>
                        {" · "}
                        <Link href={`/admin/people/${r.hostId}`} className="underline-offset-2 hover:underline" style={{ color: "#3B9BE8" }}>
                          {r.hostName ?? "host"}
                        </Link>
                      </>
                    )}
                  </span>
                  <span className="font-body text-[11.5px]" style={{ color: r.interested > 0 ? TEXT : MUTED }}>
                    {r.interested} interested
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
