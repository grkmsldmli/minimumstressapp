"use client";

import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import type { Page } from "@/lib/admin/projections";

import { CORAL, LINE, MUTED, PANEL, PANEL2, TEXT, useAdminData } from "../kit";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  align?: "left" | "right";
}

export interface FilterDef {
  name: string;
  label: string;
  options: { value: string; label: string }[];
}

interface DirectoryScreenProps<T> {
  /** The list route, without query string, e.g. /api/admin/people. */
  path: string;
  columns: Column<T>[];
  /** Where a row click goes — a detail route. */
  rowHref: (row: T) => string;
  rowKey: (row: T) => string;
  searchPlaceholder: string;
  filters?: FilterDef[];
  emptyText: string;
}

/**
 * The shared directory: a debounced search, optional filters, a table, and
 * pagination — the same shape for people, spaces and bookings so they read as
 * one tool. Every row links into a detail page: no number here dead-ends.
 */
export function DirectoryScreen<T>({
  path,
  columns,
  rowHref,
  rowKey,
  searchPlaceholder,
  filters = [],
  emptyText,
}: DirectoryScreenProps<T>) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);

  // Debounce the text so a fast typist does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const fullPath = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
    for (const [k, v] of Object.entries(filterValues)) if (v && v !== "all") params.set(k, v);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
  }, [path, debouncedQ, filterValues, page]);

  const { data, error, loading } = useAdminData<Page<T> & { query?: unknown }>(fullPath);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg flex-1 min-w-[200px]"
          style={{ backgroundColor: PANEL, border: `1px solid ${LINE}` }}
        >
          <Search size={14} color={MUTED} />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder={searchPlaceholder}
            className="bg-transparent outline-none w-full font-body text-[13px]"
            style={{ color: TEXT }}
          />
        </div>
        {filters.map((f) => (
          <select
            key={f.name}
            value={filterValues[f.name] ?? "all"}
            onChange={(e) => {
              setFilterValues((prev) => ({ ...prev, [f.name]: e.target.value }));
              setPage(1);
            }}
            aria-label={f.label}
            className="px-3 py-2 rounded-lg font-body text-[13px] outline-none"
            style={{ backgroundColor: PANEL, border: `1px solid ${LINE}`, color: TEXT }}
          >
            {f.options.map((o) => (
              <option key={o.value} value={o.value} style={{ backgroundColor: PANEL }}>
                {o.label}
              </option>
            ))}
          </select>
        ))}
      </div>

      {error ? (
        <p className="font-body text-[13px]" style={{ color: CORAL }}>Could not load: {error}</p>
      ) : !data ? (
        <p className="font-body text-[13px]" style={{ color: MUTED }}>Loading…</p>
      ) : data.items.length === 0 ? (
        <p className="font-body text-[13px] py-6 text-center" style={{ color: MUTED }}>
          {debouncedQ ? `No matches for “${debouncedQ}”.` : emptyText}
        </p>
      ) : (
        <>
          <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${LINE}` }}>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse" style={{ minWidth: 640 }}>
                <thead>
                  <tr style={{ backgroundColor: PANEL }}>
                    {columns.map((c) => (
                      <th
                        key={c.key}
                        className="font-body font-medium text-[11px] px-3 py-2.5 whitespace-nowrap"
                        style={{ color: MUTED, textAlign: c.align ?? "left" }}
                      >
                        {c.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr
                      key={rowKey(row)}
                      onClick={() => router.push(rowHref(row))}
                      className="cursor-pointer transition-colors hover:brightness-125"
                      style={{ backgroundColor: PANEL2, borderTop: `1px solid ${LINE}` }}
                    >
                      {columns.map((c) => (
                        <td
                          key={c.key}
                          className="font-body text-[12.5px] px-3 py-2.5"
                          style={{ color: TEXT, textAlign: c.align ?? "left" }}
                        >
                          {c.render(row)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="font-body text-[12px]" style={{ color: MUTED }}>
              {data.total.toLocaleString()} total{loading ? " · updating…" : ""}
            </span>
            {data.pages > 1 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={data.page <= 1}
                  className="p-1.5 rounded-lg press disabled:opacity-40"
                  style={{ backgroundColor: PANEL, border: `1px solid ${LINE}`, color: TEXT }}
                  aria-label="Previous page"
                >
                  <ChevronLeft size={15} />
                </button>
                <span className="font-body text-[12px]" style={{ color: MUTED }}>
                  {data.page} / {data.pages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
                  disabled={data.page >= data.pages}
                  className="p-1.5 rounded-lg press disabled:opacity-40"
                  style={{ backgroundColor: PANEL, border: `1px solid ${LINE}`, color: TEXT }}
                  aria-label="Next page"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
