"use client";

/**
 * The shared toolkit for the admin command center — one palette, a handful of
 * primitives, the section map, and the data hook every screen uses.
 *
 * The dark-navy "Operations" identity is deliberate: this tool lives open on a
 * second monitor all day. Colours are restrained and meaningful — sky for
 * normal/action, green for healthy, amber for warning, coral for intervention.
 * The existing dashboard keeps its own inline copies of these tokens; this file
 * is the shared source for everything new so the sections read as one product.
 */

import {
  Activity,
  Banknote,
  Briefcase,
  CalendarRange,
  Command as CommandIcon,
  LayoutGrid,
  LineChart,
  ScrollText,
  ShieldAlert,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

export const BG = "#0E1D2E";
export const PANEL = "#152A40";
export const PANEL2 = "#0E1D2E";
export const LINE = "rgba(255,255,255,0.08)";
export const MUTED = "#8CA3BD";
export const TEXT = "#E7EEF6";
export const SKY = "#3B9BE8";
export const GREEN = "#4ADE80";
export const AMBER = "#E8A33D";
export const CORAL = "#F2695C";
export const VIOLET = "#9B8AFB";

export interface AdminSection {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

/** The primary navigation, in the order the spec lays out. */
export const SECTIONS: AdminSection[] = [
  { key: "command", label: "Command", href: "/admin", icon: CommandIcon },
  { key: "people", label: "People", href: "/admin/people", icon: Users },
  { key: "spaces", label: "Spaces", href: "/admin/spaces", icon: LayoutGrid },
  { key: "bookings", label: "Bookings", href: "/admin/bookings", icon: CalendarRange },
  { key: "work", label: "Work", href: "/admin/work", icon: Briefcase },
  { key: "money", label: "Money", href: "/admin/money", icon: Banknote },
  { key: "growth", label: "Growth", href: "/admin/growth", icon: LineChart },
  { key: "trust", label: "Trust & Safety", href: "/admin/trust", icon: ShieldAlert },
  { key: "system", label: "System", href: "/admin/system", icon: Wrench },
  { key: "audit", label: "Audit log", href: "/admin/audit", icon: ScrollText },
];

export { Activity as ActivityIcon };

/* ---------------- data hook ---------------- */

export interface AdminData<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  updatedAt: Date | null;
  reload: () => void;
}

/**
 * Fetch one admin JSON route with a manual reload and an optional poll. Every
 * admin route is staff-gated server-side and returns 404 to non-staff, so a 404
 * here means "not for you", surfaced plainly rather than as a broken screen.
 */
export function useAdminData<T>(path: string, pollMs?: number): AdminData<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch(path, { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(res.status === 404 ? "Not found" : `Request failed (${res.status})`);
        const json = (await res.json()) as T;
        if (cancelled) return;
        setData(json);
        setError(null);
        setUpdatedAt(new Date());
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Something went wrong");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    if (!pollMs) return () => { cancelled = true; };
    const timer = setInterval(run, pollMs);
    return () => { cancelled = true; clearInterval(timer); };
  }, [path, revision, pollMs]);

  return { data, error, loading, updatedAt, reload };
}

/* ---------------- primitives ---------------- */

export function Panel({
  title,
  count,
  right,
  children,
}: {
  title?: string;
  count?: number;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl p-4" style={{ backgroundColor: PANEL, border: `1px solid ${LINE}` }}>
      {(title || right) && (
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-body font-semibold text-[13px]" style={{ color: TEXT }}>
            {title}
            {count !== undefined && <span style={{ color: MUTED }}> · {count}</span>}
          </h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Card({
  children,
  tone = "plain",
}: {
  children: React.ReactNode;
  tone?: "plain" | "warn" | "bad" | "good";
}) {
  const border =
    tone === "bad" ? "rgba(242,105,92,0.4)" : tone === "warn" ? "rgba(232,163,61,0.4)" : tone === "good" ? "rgba(74,222,128,0.4)" : LINE;
  return (
    <div className="rounded-xl p-3.5 mb-2.5 last:mb-0" style={{ backgroundColor: PANEL2, border: `1px solid ${border}` }}>
      {children}
    </div>
  );
}

/** A key figure. `strong` sky-borders it for the number that matters most. */
export function Stat({
  label,
  value,
  sub,
  strong,
  icon: Icon,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  strong?: boolean;
  icon?: LucideIcon;
  tone?: "sky" | "muted";
}) {
  const valueColor = tone === "muted" ? MUTED : strong ? SKY : TEXT;
  return (
    <div
      className="rounded-xl p-3.5"
      style={{ backgroundColor: PANEL, border: `1px solid ${strong ? "rgba(59,155,232,0.5)" : LINE}` }}
    >
      <div className="flex items-center gap-1.5">
        {Icon && <Icon size={13} color={MUTED} />}
        <p className="font-body font-medium text-[11.5px]" style={{ color: MUTED }}>{label}</p>
      </div>
      <p className="font-body font-semibold mt-1" style={{ color: valueColor, fontSize: strong ? 22 : 18 }}>
        {value}
      </p>
      {sub && <p className="font-body font-normal text-[11px] mt-0.5" style={{ color: MUTED }}>{sub}</p>}
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  healthy: GREEN,
  attention: AMBER,
  critical: CORAL,
  unknown: MUTED,
};

export function StatusDot({ state }: { state: "healthy" | "attention" | "critical" | "unknown" }) {
  return (
    <span
      className="inline-block rounded-full shrink-0"
      style={{ width: 8, height: 8, backgroundColor: STATUS_COLOR[state] ?? MUTED }}
    />
  );
}

export function Pill({ children, color = SKY }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-body font-medium text-[11px]"
      style={{ backgroundColor: `${color}22`, color }}
    >
      {children}
    </span>
  );
}

export function Muted({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`font-body ${className}`} style={{ color: MUTED }}>{children}</span>;
}

/** A clickable link into the business graph — no dead-end ids. */
export function EntityLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="press font-body underline-offset-2 hover:underline" style={{ color: SKY }}>
      {children}
    </Link>
  );
}

/** "Not instrumented yet" vs a real zero — the two must never look the same. */
export function NotInstrumented() {
  return <span className="font-body italic text-[12px]" style={{ color: MUTED }}>Not instrumented yet</span>;
}

export function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
