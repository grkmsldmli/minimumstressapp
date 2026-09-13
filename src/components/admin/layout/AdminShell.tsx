"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  BG,
  CORAL,
  GREEN,
  LINE,
  MUTED,
  PANEL,
  SECTIONS,
  SKY,
  TEXT,
  useAdminData,
} from "../kit";

interface AttentionItem {
  key: string;
  count: number;
  href: string;
}

interface CommandSummary {
  urgentCount: number;
  /** Everything waiting on staff, each tagged with the section it lives in. */
  needsAttention?: AttentionItem[];
}

/** Which top-level section a needs-attention href belongs to ("/admin/trust" → "trust"). */
function sectionOf(href: string): string {
  return href.split("/")[2] ?? "";
}

/** Which section owns the current path (longest matching href wins so
 *  /admin/people/[id] highlights People, and /admin itself stays Command). */
function activeKey(pathname: string): string {
  let best = SECTIONS[0];
  for (const s of SECTIONS) {
    if (s.href === "/admin" ? pathname === "/admin" : pathname.startsWith(s.href)) {
      if (s.href.length >= best.href.length) best = s;
    }
  }
  return best.key;
}

function NavLinks({
  active,
  counts = {},
  onNavigate,
}: {
  active: string;
  /** Per-section count of things waiting on staff, shown as a badge. */
  counts?: Record<string, number>;
  onNavigate?: () => void;
}) {
  return (
    <>
      {SECTIONS.map((s) => {
        const on = s.key === active;
        const Icon = s.icon;
        const count = counts[s.key] ?? 0;
        return (
          <Link
            key={s.key}
            href={s.href}
            onClick={onNavigate}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg font-body text-[13px] press whitespace-nowrap"
            style={{
              backgroundColor: on ? "rgba(59,155,232,0.16)" : "transparent",
              color: on ? "#9CCBF3" : MUTED,
              border: on ? "1px solid rgba(59,155,232,0.32)" : "1px solid transparent",
            }}
          >
            <Icon size={15} />
            {s.label}
            {count > 0 && (
              <span
                className="ml-auto inline-flex items-center justify-center rounded-full font-body font-semibold"
                aria-label={`${count} waiting`}
                style={{
                  minWidth: 18,
                  height: 18,
                  padding: "0 5px",
                  fontSize: 11,
                  lineHeight: 1,
                  backgroundColor: "rgba(242,105,92,0.18)",
                  color: CORAL,
                  border: "1px solid rgba(242,105,92,0.4)",
                }}
              >
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </>
  );
}

/**
 * The command-center frame: a persistent left rail on desktop, a scrolling chip
 * bar on narrower/tablet widths, and a header carrying the section name, the
 * live-refresh state, global search, and the count of things needing attention.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/admin";
  const router = useRouter();
  const active = activeKey(pathname);
  const section = SECTIONS.find((s) => s.key === active) ?? SECTIONS[0];
  const [q, setQ] = useState("");
  // A compact poll: what is on fire, what is waiting per section, and are we live.
  const { data, error, updatedAt } = useAdminData<CommandSummary>("/api/admin/command", 20_000);
  const urgent = data?.urgentCount ?? 0;

  // Per-section badge counts, and the whole backlog for the header, derived from
  // the one needs-attention list the command route already returns. So a new
  // review or request lights up the nav the moment the next poll lands, rather
  // than staying invisible until someone thinks to open Trust & Safety.
  const attention = data?.needsAttention ?? [];
  const sectionCounts: Record<string, number> = {};
  for (const item of attention) {
    const key = sectionOf(item.href);
    if (key) sectionCounts[key] = (sectionCounts[key] ?? 0) + item.count;
  }
  const waiting = attention.reduce((total, item) => total + item.count, 0);

  // Mirror the backlog into the browser tab, so a founder who leaves the admin
  // open in a background tab sees "(3) Command center" the moment work arrives —
  // the closest thing to a notification without a bell.
  useEffect(() => {
    document.title = waiting > 0 ? `(${waiting}) Command center` : "Command center";
  }, [waiting]);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (term.length >= 2) router.push(`/admin/search?q=${encodeURIComponent(term)}`);
  };

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: BG, color: TEXT }}>
      {/* Desktop sidebar */}
      <aside
        className="hidden lg:flex flex-col gap-1 w-56 shrink-0 p-3 sticky top-0 h-screen overflow-y-auto"
        style={{ borderRight: `1px solid ${LINE}` }}
      >
        <div className="px-3 py-3">
          <p className="font-display italic font-semibold text-[17px]" style={{ color: TEXT }}>
            Minimum Stress
          </p>
          <p className="font-body text-[11px]" style={{ color: MUTED }}>Command center</p>
        </div>
        <NavLinks active={active} counts={sectionCounts} />
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Header */}
        <header
          className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 flex-wrap"
          style={{ backgroundColor: BG, borderBottom: `1px solid ${LINE}` }}
        >
          <div className="min-w-0">
            <h1 className="font-body font-semibold text-[15px] truncate" style={{ color: TEXT }}>
              {section.label}
            </h1>
            <p className="font-body text-[11px] flex items-center gap-1.5" style={{ color: MUTED }}>
              <span
                className="inline-block rounded-full"
                style={{ width: 7, height: 7, backgroundColor: error ? CORAL : GREEN }}
              />
              {error ? "Offline" : updatedAt ? `Live · updated ${updatedAt.toLocaleTimeString()}` : "Connecting…"}
            </p>
          </div>

          <form onSubmit={submitSearch} className="flex-1 min-w-[180px] max-w-md ml-auto">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: PANEL, border: `1px solid ${LINE}` }}>
              <Search size={14} color={MUTED} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search people, spaces, bookings…"
                aria-label="Global admin search"
                className="bg-transparent outline-none w-full font-body text-[13px]"
                style={{ color: TEXT }}
              />
            </div>
          </form>

          {waiting > 0 && (
            <Link
              href="/admin/trust"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg font-body font-semibold text-[12.5px] press shrink-0"
              style={
                urgent > 0
                  ? { backgroundColor: "rgba(242,105,92,0.16)", color: CORAL, border: `1px solid rgba(242,105,92,0.4)` }
                  : { backgroundColor: "rgba(59,155,232,0.14)", color: SKY, border: `1px solid rgba(59,155,232,0.4)` }
              }
            >
              {/* Coral when something is genuinely urgent; sky when it is just
                  work waiting (a review, a request) so nothing goes unseen. */}
              {urgent > 0 ? `${urgent} urgent · ${waiting} waiting` : `${waiting} waiting`}
            </Link>
          )}
        </header>

        {/* Tablet / narrow nav */}
        <nav
          className="lg:hidden flex gap-1.5 px-3 py-2 overflow-x-auto"
          style={{ borderBottom: `1px solid ${LINE}` }}
        >
          <NavLinks active={active} counts={sectionCounts} />
        </nav>

        <main className="flex-1 p-4" style={{ backgroundColor: BG }}>
          {children}
        </main>
      </div>
    </div>
  );
}
