"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import type { AuditRow } from "@/app/api/admin/audit/route";
import type { Page } from "@/lib/admin/projections";

import { CORAL, dateTime, LINE, MUTED, Muted, PANEL, PANEL2, Pill, SKY, TEXT, useAdminData } from "../kit";

/** Which detail page an audited target links to, when it has one. */
function targetHref(type: string | null, id: string | null): string | null {
  if (!id) return null;
  if (type === "profile" || type === "account_change_request") return `/admin/people/${id}`;
  if (type === "listing") return `/admin/spaces/${id}`;
  return null;
}

export function AuditScreen() {
  const [page, setPage] = useState(1);
  const { data, error, loading } = useAdminData<Page<AuditRow>>(`/api/admin/audit?page=${page}`);

  if (error) return <p className="font-body text-[13px]" style={{ color: CORAL }}>Could not load: {error}</p>;
  if (loading && !data) return <p className="font-body text-[13px]" style={{ color: MUTED }}>Loading…</p>;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-3">
      <Muted className="text-[12px]">Every staff decision, newest first. Read-only.</Muted>

      {data.items.length === 0 ? (
        <p className="font-body text-[13px] py-6 text-center" style={{ color: MUTED }}>
          No actions recorded yet. Decisions taken in Trust &amp; Safety will appear here.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {data.items.map((row) => {
            const href = targetHref(row.targetType, row.targetId);
            return (
              <div key={row.id} className="rounded-lg px-3 py-2.5" style={{ backgroundColor: PANEL2, border: `1px solid ${LINE}` }}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="flex items-center gap-2">
                    <Pill color={SKY}>{row.action.replace(/_/g, " ")}</Pill>
                    {row.targetType && (
                      href ? (
                        <Link href={href} className="font-body text-[12px] underline-offset-2 hover:underline" style={{ color: SKY }}>
                          {row.targetType}
                        </Link>
                      ) : (
                        <Muted className="text-[12px]">{row.targetType}</Muted>
                      )
                    )}
                  </span>
                  <span className="font-body text-[11px]" style={{ color: MUTED }}>{dateTime(row.occurredAt)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 mt-1">
                  <span className="font-body text-[11.5px]" style={{ color: MUTED }}>{row.adminEmail ?? "unknown admin"}</span>
                  {row.reason && <span className="font-body text-[11.5px] truncate" style={{ color: TEXT }}>“{row.reason}”</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {data.pages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={data.page <= 1}
            className="p-1.5 rounded-lg press disabled:opacity-40"
            style={{ backgroundColor: PANEL, border: `1px solid ${LINE}`, color: TEXT }}
            aria-label="Previous page"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="font-body text-[12px]" style={{ color: MUTED }}>{data.page} / {data.pages}</span>
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
  );
}
