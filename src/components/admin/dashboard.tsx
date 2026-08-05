"use client";

import { AlertTriangle, Check, FileText, Loader2, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { AdminQueue } from "@/lib/admin/queue";
import { formatCents } from "@/lib/money";

/**
 * What is waiting for a person.
 *
 * Ordered by who is hurt while nobody looks: a safety report first, then a
 * listing whose host is waiting to earn, then requests, then the numbers. A
 * dashboard that opens on revenue is one where the unread report stays unread.
 *
 * Plainer than the rest of the app on purpose. This is a work surface used by
 * one person who already knows what everything means, and every minute spent
 * making it beautiful is a minute not spent on the screens customers see.
 */
export function AdminDashboard() {
  const [queue, setQueue] = useState<AdminQueue | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Reloaded by bumping a counter rather than by calling a function.
   *
   * The fetch lives inside the effect so nothing is set before its first
   * await — a synchronous setState in an effect body is a re-render before the
   * request has even left. It also buys cancellation, which matters here
   * because acting on an item triggers a reload and the answer to the previous
   * one may still be in flight.
   */
  const [revision, setRevision] = useState(0);
  const reload = () => setRevision((n) => n + 1);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/admin");
        if (!response.ok) throw new Error(`Could not load the queue (${response.status})`);
        const loaded = (await response.json()) as AdminQueue;
        if (cancelled) return;
        setQueue(loaded);
        setError(null);
      } catch (failure) {
        if (cancelled) return;
        setError(failure instanceof Error ? failure.message : "Could not load the queue");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [revision]);

  const act = async (action: string, id: string, note?: string) => {
    setBusy(id);
    setError(null);
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id, note }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "That did not work");
      reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That did not work");
    } finally {
      setBusy(null);
    }
  };

  /**
   * Opens a document through a link that expires in two minutes.
   *
   * Fetched at click time rather than rendered into the page: a signed URL is
   * a bearer token, and putting one in the HTML would leave it in the browser
   * history and in any screenshot of this screen.
   */
  const openDocument = async (path: string) => {
    const response = await fetch(`/api/admin/document?path=${encodeURIComponent(path)}`);
    const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
    if (body.url) window.open(body.url, "_blank", "noopener");
    else setError(body.error ?? "Could not open that document");
  };

  if (!queue) {
    return (
      <main className="min-h-screen bg-white p-8">
        <p className="font-body text-[13px] text-ink-soft">
          {error ?? "Loading the queue…"}
        </p>
      </main>
    );
  }

  const nothingWaiting =
    queue.escalations.length === 0 &&
    queue.pendingListings.length === 0 &&
    queue.accountChangeRequests.length === 0;

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between">
          <h1 className="font-display italic font-semibold text-[24px] text-navy">Queue</h1>
          <button
            type="button"
            onClick={reload}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full font-body text-[12px] press"
            style={{ border: "1px solid #DCE7F2", color: "#16304E" }}
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>

        {error && (
          <p
            className="mt-4 px-4 py-3 rounded-xl font-body text-[12px]"
            style={{ backgroundColor: "#FEF2F0", color: "#C4503F" }}
          >
            {error}
          </p>
        )}

        {nothingWaiting && (
          <p className="mt-6 font-body font-light text-[13px] text-ink-soft">
            Nothing is waiting. Everything below is context.
          </p>
        )}

        {/* Safety first, always. */}
        <Section title="Safety and low ratings" count={queue.escalations.length}>
          {queue.escalations.map((item) => (
            <div
              key={item.id}
              className="rounded-xl p-4"
              style={{
                border: `1px solid ${item.priority === "safety" ? "#F6D5D0" : "#E7EEF6"}`,
                backgroundColor: item.priority === "safety" ? "#FEF8F7" : "#fff",
              }}
            >
              <div className="flex items-center gap-2">
                {item.priority === "safety" && <AlertTriangle size={13} color="#C4503F" />}
                <span className="font-body font-medium text-[12px] text-navy">
                  {item.safetyConcern ? "Safety concern" : `${item.overall} stars`}
                  {item.spaceName ? ` · ${item.spaceName}` : ""}
                </span>
                <span className="font-body font-light text-[11px] text-ink-faint">
                  from the {item.role === "host" ? "studio" : "practitioner"}
                </span>
              </div>

              {item.comment && (
                <p className="font-body font-light text-[12px] mt-2 leading-relaxed text-ink-soft">
                  “{item.comment}”
                </p>
              )}

              <ResolveBox
                busy={busy === item.id}
                onResolve={(note) => void act("resolve_escalation", item.id, note)}
              />
            </div>
          ))}
        </Section>

        <Section title="Listings waiting for review" count={queue.pendingListings.length}>
          {queue.pendingListings.map((listing) => (
            <div key={listing.id} className="rounded-xl p-4" style={{ border: "1px solid #E7EEF6" }}>
              <p className="font-body font-medium text-[13px] text-navy">{listing.name}</p>
              <p className="font-body font-light text-[11.5px] mt-1 text-ink-soft">
                {listing.category} · {formatCents(listing.hourlyRateCents)}/hr ·{" "}
                {listing.hostEmail ?? "unknown host"}
              </p>
              {listing.addressLine && (
                <p className="font-body font-light text-[11.5px] mt-1 text-ink-faint">
                  {listing.addressLine}
                </p>
              )}

              <div className="flex flex-wrap gap-2 mt-3">
                {listing.subleaseDocPath ? (
                  <DocButton
                    label="Sublease proof"
                    onClick={() => void openDocument(listing.subleaseDocPath!)}
                  />
                ) : (
                  <span className="font-body text-[11px] text-coral-deep">
                    No sublease document — cannot be approved
                  </span>
                )}
                {listing.insuranceDocPath && (
                  <DocButton
                    label="Insurance"
                    onClick={() => void openDocument(listing.insuranceDocPath!)}
                  />
                )}
              </div>

              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  disabled={busy === listing.id || !listing.subleaseDocPath}
                  onClick={() => void act("approve_listing", listing.id)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full font-body font-medium text-[12px] text-white press"
                  style={{ backgroundColor: listing.subleaseDocPath ? "#3B9BE8" : "#C6D8E8" }}
                >
                  {busy === listing.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busy === listing.id}
                  onClick={() => void act("reject_listing", listing.id)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full font-body font-medium text-[12px] press"
                  style={{ border: "1px solid #DCE7F2", color: "#16304E" }}
                >
                  <X size={12} /> Reject
                </button>
              </div>
            </div>
          ))}
        </Section>

        <Section title="Account change requests" count={queue.accountChangeRequests.length}>
          {queue.accountChangeRequests.map((request) => (
            <div key={request.id} className="rounded-xl p-4" style={{ border: "1px solid #E7EEF6" }}>
              <p className="font-body font-medium text-[12.5px] text-navy">
                {request.email ?? "unknown"} — {request.from} → {request.to}
              </p>
              {request.reason && (
                <p className="font-body font-light text-[12px] mt-1.5 leading-relaxed text-ink-soft">
                  “{request.reason}”
                </p>
              )}
              <button
                type="button"
                disabled={busy === request.id}
                onClick={() => void act("approve_account_change", request.id)}
                className="mt-3 px-4 py-2 rounded-full font-body font-medium text-[12px] text-white press"
                style={{ backgroundColor: "#3B9BE8" }}
              >
                Approve the switch
              </button>
            </div>
          ))}
        </Section>

        {/* Context, last, where it cannot crowd out the work. */}
        <div className="mt-8 pt-6 flex gap-6" style={{ borderTop: "1px solid #F0ECE0" }}>
          <Stat label="Live listings" value={String(queue.summary.activeListings)} />
          <Stat label="Sessions this month" value={String(queue.summary.sessionsThisMonth)} />
          <Stat label="Credit owed" value={formatCents(queue.summary.creditOwedCents)} />
        </div>
      </div>
    </main>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;

  return (
    <section className="mt-7">
      <h2 className="font-body font-medium text-[11px] uppercase tracking-[0.14em] text-sky">
        {title} · {count}
      </h2>
      <div className="flex flex-col gap-2.5 mt-3">{children}</div>
    </section>
  );
}

function DocButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-body text-[11.5px] press"
      style={{ backgroundColor: "#F4F8FC", color: "#16304E" }}
    >
      <FileText size={12} /> {label}
    </button>
  );
}

/** A resolution needs a note, or the record cannot say what was decided. */
function ResolveBox({ busy, onResolve }: { busy: boolean; onResolve: (note: string) => void }) {
  const [note, setNote] = useState("");

  return (
    <div className="flex gap-2 mt-3">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What did you decide?"
        aria-label="Resolution note"
        className="flex-1 px-3 py-2 rounded-lg font-body text-[12px] outline-none text-navy bg-white"
        style={{ border: "1px solid #DCE7F2" }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => onResolve(note)}
        className="px-4 py-2 rounded-lg font-body font-medium text-[12px] text-white press"
        style={{ backgroundColor: "#16304E" }}
      >
        {busy ? "…" : "Resolve"}
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-body font-light text-[10.5px] uppercase tracking-wide text-ink-faint">
        {label}
      </p>
      <p className="font-body font-semibold text-[16px] mt-0.5 text-navy">{value}</p>
    </div>
  );
}
