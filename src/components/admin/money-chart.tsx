"use client";

import type { DayMoney } from "@/lib/admin/queue";
import { formatCents } from "@/lib/money";

const PANEL = "#152A40";
const LINE = "rgba(255,255,255,0.08)";
const MUTED = "#8CA3BD";
const SKY = "#3B9BE8";

/**
 * Two weeks of money, ours against the gross.
 *
 * Both, because either alone misleads. Gross on its own flatters — most of it
 * belongs to hosts and is never ours. Our take on its own hides the size of
 * what is moving through, which is the number that says whether the
 * marketplace is working.
 *
 * Captured sessions only. A booking that was made and never charged is real
 * activity and not revenue, and a chart that counted it would show money that
 * does not exist.
 */
export function MoneyChart({ days }: { days: DayMoney[] }) {
  const peak = Math.max(1, ...days.map((d) => d.grossCents));
  const total = days.reduce((sum, d) => sum + d.platformCents, 0);
  const gross = days.reduce((sum, d) => sum + d.grossCents, 0);

  return (
    <section
      className="rounded-xl px-4 py-4"
      style={{ backgroundColor: PANEL, border: `1px solid ${LINE}` }}
    >
      <div className="flex items-baseline justify-between">
        <p
          className="font-body font-medium text-[10px] uppercase tracking-[0.14em]"
          style={{ color: SKY }}
        >
          Money, last 14 days
        </p>
        <p className="font-body text-[11.5px]" style={{ color: MUTED }}>
          <span style={{ color: "#fff" }}>{formatCents(total)}</span> of {formatCents(gross)}
        </p>
      </div>

      <div className="flex items-end gap-1 mt-3" style={{ height: 64 }}>
        {days.map((day) => (
          <div
            key={day.day}
            className="flex-1 flex flex-col justify-end"
            style={{ height: "100%" }}
            title={`${day.day} · ${formatCents(day.platformCents)} of ${formatCents(day.grossCents)}`}
          >
            {/*
              Ours drawn inside the gross rather than beside it, because it is
              a part of that number and two adjacent bars would read as two
              separate takings.
            */}
            <div
              className="rounded-t-sm relative"
              style={{
                height: `${Math.max(2, (day.grossCents / peak) * 100)}%`,
                backgroundColor: "rgba(59,155,232,0.28)",
              }}
            >
              <div
                className="absolute bottom-0 inset-x-0 rounded-t-sm"
                style={{
                  height: day.grossCents === 0
                    ? 0
                    : `${(day.platformCents / day.grossCents) * 100}%`,
                  backgroundColor: SKY,
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-between mt-1.5">
        <span className="font-body font-light text-[10px]" style={{ color: MUTED }}>
          {label(days[0]?.day)}
        </span>
        <span className="font-body font-light text-[10px]" style={{ color: MUTED }}>
          {label(days[days.length - 1]?.day)}
        </span>
      </div>
    </section>
  );
}

function label(day: string | undefined): string {
  if (!day) return "";
  return new Date(`${day}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
