"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import {
  BG,
  CORAL,
  GREEN,
  LINE,
  MUTED,
  PANEL,
  SECTIONS,
  TEXT,
  useAdminData,
} from "../kit";

interface CommandSummary {
  urgentCount: number;
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

function NavLinks({ active, onNavigate }: { active: string; onNavigate?: () => void }) {
  return (
    <>
      {SECTIONS.map((s) => {
        const on = s.key === active;
        const Icon = s.icon;
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
  // A compact poll for the header only: what is on fire, and are we live.
  const { data, error, updatedAt } = useAdminData<CommandSummary>("/api/admin/command", 20_000);
  const urgent = data?.urgentCount ?? 0;

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
        <NavLinks active={active} />
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

          {urgent > 0 && (
            <Link
              href="/admin/trust"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg font-body font-semibold text-[12.5px] press shrink-0"
              style={{ backgroundColor: "rgba(242,105,92,0.16)", color: CORAL, border: `1px solid rgba(242,105,92,0.4)` }}
            >
              {urgent} need{urgent === 1 ? "s" : ""} attention
            </Link>
          )}
        </header>

        {/* Tablet / narrow nav */}
        <nav
          className="lg:hidden flex gap-1.5 px-3 py-2 overflow-x-auto"
          style={{ borderBottom: `1px solid ${LINE}` }}
        >
          <NavLinks active={active} />
        </nav>

        <main className="flex-1 p-4" style={{ backgroundColor: BG }}>
          {children}
        </main>
      </div>
    </div>
  );
}
