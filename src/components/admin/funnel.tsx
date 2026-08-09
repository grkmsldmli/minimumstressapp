"use client";

import type { FunnelStep } from "@/lib/admin/queue";

const PANEL = "#152A40";
const LINE = "rgba(255,255,255,0.08)";
const MUTED = "#8CA3BD";
const SKY = "#3B9BE8";

/**
 * Where people stop.
 *
 * Each step is a subset of the one above, so the gap between two bars is a
 * place somebody gave up — signed up and never chose a side, chose host and
 * never listed, listed and never went live. A funnel that did not nest would
 * just be five unrelated numbers next to each other.
 *
 * The drop is labelled rather than left to be read off the bar lengths,
 * because the useful quantity is how many were lost between two steps, and
 * eyeballing two rectangles is not how anybody works that out.
 */
export function Funnel({ steps }: { steps: FunnelStep[] }) {
  const top = steps[0]?.count ?? 0;

  return (
    <section
      className="rounded-xl px-4 py-4"
      style={{ backgroundColor: PANEL, border: `1px solid ${LINE}` }}
    >
      <p
        className="font-body font-medium text-[10px] uppercase tracking-[0.14em]"
        style={{ color: SKY }}
      >
        Signup to session
      </p>

      {top === 0 ? (
        <p className="font-body font-light text-[11.5px] mt-2" style={{ color: MUTED }}>
          Nobody has signed up yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2 mt-3">
          {steps.map((step, i) => {
            const previous = i === 0 ? null : steps[i - 1].count;
            const lost = previous === null ? 0 : previous - step.count;

            return (
              <div key={step.label}>
                <div className="flex items-baseline justify-between">
                  <span className="font-body text-[11.5px]" style={{ color: "#fff" }}>
                    {step.label}
                  </span>
                  <span className="font-body font-medium text-[11.5px]" style={{ color: "#fff" }}>
                    {step.count}
                    {lost > 0 && (
                      <span className="font-light ml-1.5" style={{ color: "#F2A79E" }}>
                        −{lost}
                      </span>
                    )}
                  </span>
                </div>
                <div
                  className="mt-1 rounded-full overflow-hidden"
                  style={{ height: 6, backgroundColor: "rgba(255,255,255,0.06)" }}
                >
                  <div
                    style={{
                      // Against the top of the funnel, not the step above, so
                      // the bars shrink the way the population does.
                      width: `${Math.round((step.count / top) * 100)}%`,
                      height: "100%",
                      backgroundColor: i === steps.length - 1 ? "#4ADE80" : SKY,
                      opacity: 1 - i * 0.12,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
