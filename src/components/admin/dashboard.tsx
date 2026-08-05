"use client";

import {
  AlertTriangle,
  Building2,
  CalendarClock,
  Check,
  FileText,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { AdminQueue } from "@/lib/admin/queue";
import { formatCents } from "@/lib/money";

/**
 * The operations screen.
 *
 * Two halves, and the order between them is the whole design. What is waiting
 * for a decision comes first, ranked by who is hurt while nobody looks — a
 * safety report, then a host earning money that cannot reach them, then a
 * listing nobody has reviewed. The numbers come after. A dashboard that opens
 * on revenue is one where the unread report stays unread.
 *
 * Dark, unlike the rest of the app, and not as decoration: this is the screen
 * somebody leaves open on a second monitor all day, and the app's white is
 * built for a phone held for two minutes.
 */

/** Often enough to feel live, rarely enough not to be a load generator. */
const REFRESH_MS = 20_000;

const BG = "#0E1D2E";
const PANEL = "#152A40";
const LINE = "rgba(255,255,255,0.08)";
const MUTED = "#8CA3BD";
const SKY = "#3B9BE8";
const CORAL = "#F2695C";

export function AdminDashboard() {
  const [queue, setQueue] = useState<AdminQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [revision, setRevision] = useState(0);

  const reload = () => setRevision((n) => n + 1);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch("/api/admin");
        if (!response.ok) throw new Error(`Could not load the queue (${response.status})`);
        const loaded = (await response.json()) as AdminQueue;
        if (cancelled) return;
        setQueue(loaded);
        setUpdatedAt(new Date());
        setError(null);
      } catch (failure) {
        if (cancelled) return;
        setError(failure instanceof Error ? failure.message : "Could not load the queue");
      }
    };

    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [revision]);

  const act = async (action: string, id: string, note?: string) => {
    setBusy(id);
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
   * Fetched at click time, never rendered into the page.
   *
   * A signed URL is a bearer token. One in the HTML is one in the browser
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
      <main style={{ minHeight: "100vh", backgroundColor: BG }} className="p-10">
        <p className="font-body text-[13px]" style={{ color: MUTED }}>
          {error ?? "Loading…"}
        </p>
      </main>
    );
  }

  const { counts, money } = queue;

  /**
   * The things that are actively costing somebody something right now.
   *
   * Above every number, because a report nobody has read and money that cannot
   * reach a host are the two states where waiting makes it worse.
   */
  const urgent: { key: string; text: string }[] = [
    ...queue.escalations
      .filter((e) => e.priority === "safety")
      .map((e) => ({
        key: `safety-${e.id}`,
        text: `Safety concern reported${e.spaceName ? ` at ${e.spaceName}` : ""}`,
      })),
    ...(queue.unpayableHosts.length > 0
      ? [
          {
            key: "unpayable",
            text: `${queue.unpayableHosts.length} host${
              queue.unpayableHosts.length === 1 ? "" : "s"
            } owed ${formatCents(
              queue.unpayableHosts.reduce((total, host) => total + host.owedCents, 0),
            )} with no payout account`,
          },
        ]
      : []),
    ...(queue.failedNotifications.filter((n) => n.givenUp).length > 0
      ? [
          {
            key: "notifications",
            text: `${queue.failedNotifications.filter((n) => n.givenUp).length} message${
              queue.failedNotifications.filter((n) => n.givenUp).length === 1 ? "" : "s"
            } never reached anybody`,
          },
        ]
      : []),
    ...(counts.uncaptured > 0
      ? [
          {
            key: "uncaptured",
            text: `${counts.uncaptured} session${
              counts.uncaptured === 1 ? "" : "s"
            } started and never charged`,
          },
        ]
      : []),
  ];

  const nothingWaiting =
    urgent.length === 0 &&
    queue.escalations.length === 0 &&
    queue.pendingListings.length === 0 &&
    queue.accountChangeRequests.length === 0;

  return (
    <main style={{ minHeight: "100vh", backgroundColor: BG }}>
      <div className="max-w-6xl mx-auto px-6 py-7">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-display italic font-semibold text-[26px]" style={{ color: "#fff" }}>
              Operations
            </h1>
            <p className="font-body font-light text-[11.5px] mt-0.5" style={{ color: MUTED }}>
              Minimum Stress · everything at once
            </p>
          </div>
          <LiveDot updatedAt={updatedAt} onRefresh={reload} />
        </header>

        {error && <Banner>{error}</Banner>}

        {urgent.map((item) => (
          <Banner key={item.key}>
            <AlertTriangle size={13} className="shrink-0" /> {item.text}
          </Banner>
        ))}

        {nothingWaiting && (
          <p className="font-body font-light text-[12.5px] mt-5" style={{ color: MUTED }}>
            Nothing needs a decision right now.
          </p>
        )}

        {/* Ours is emphasised; the host column is there to size the market,
            not to claim it. */}
        <section
          className="grid gap-3 mt-6"
          style={{ gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))" }}
        >
          <Stat label="Our revenue, this month" value={formatCents(money.platformCents)} strong />
          <Stat label="Paid to hosts, this month" value={formatCents(money.hostCents)} />
          <Stat label="Booked, this month" value={formatCents(money.grossCents)} />
          <Stat label="Our revenue, all time" value={formatCents(money.platformAllTimeCents)} />
        </section>

        <section
          className="grid gap-3 mt-3"
          style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}
        >
          <Stat label="Live listings" value={String(counts.activeListings)} icon={Building2} />
          <Stat label="Practitioners" value={String(counts.practitioners)} icon={Users} />
          <Stat label="Hosts" value={String(counts.hosts)} icon={Users} />
          <Stat label="Sessions this month" value={String(counts.sessionsThisMonth)} icon={Check} />
          <Stat label="Still to come" value={String(counts.upcomingSessions)} icon={CalendarClock} />
        </section>

        <Chart days={queue.bookingsByDay} />

        <div
          className="grid gap-4 mt-6"
          style={{ gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))" }}
        >
          <div className="flex flex-col gap-4">
            <Panel title="Safety and low ratings" count={queue.escalations.length}>
              {queue.escalations.map((item) => (
                <Card key={item.id} tone={item.priority === "safety" ? "bad" : "plain"}>
                  <p className="font-body font-medium text-[12.5px]" style={{ color: "#fff" }}>
                    {item.safetyConcern ? "Safety concern" : `${item.overall} stars`}
                    {item.spaceName ? ` · ${item.spaceName}` : ""}
                  </p>
                  <p className="font-body font-light text-[11px] mt-0.5" style={{ color: MUTED }}>
                    from the {item.role === "host" ? "studio" : "practitioner"}
                  </p>
                  {item.comment && (
                    <p
                      className="font-body font-light text-[11.5px] mt-2 leading-relaxed"
                      style={{ color: "#C7D6E6" }}
                    >
                      &ldquo;{item.comment}&rdquo;
                    </p>
                  )}
                  <ResolveBox
                    busy={busy === item.id}
                    onResolve={(note) => void act("resolve_escalation", item.id, note)}
                  />
                </Card>
              ))}
            </Panel>

            <Panel title="Messages that failed" count={queue.failedNotifications.length}>
              {queue.failedNotifications.map((item) => (
                <Card key={item.id} tone={item.givenUp ? "bad" : "warn"}>
                  <p className="font-body font-medium text-[12.5px]" style={{ color: "#fff" }}>
                    {item.kind.replace(/_/g, " ")} · {item.channel}
                  </p>
                  <p className="font-body font-light text-[11px] mt-1" style={{ color: MUTED }}>
                    {item.givenUp
                      ? `Given up after ${item.attempts} attempt${item.attempts === 1 ? "" : "s"}`
                      : `${item.attempts} attempt${item.attempts === 1 ? "" : "s"} so far — still retrying`}
                  </p>
                  {item.lastError && (
                    <p
                      className="font-body font-light text-[10.5px] mt-1.5 leading-relaxed"
                      style={{ color: "#9FB3C8" }}
                    >
                      {item.lastError}
                    </p>
                  )}
                </Card>
              ))}
            </Panel>

            <Panel title="Accounts at risk" count={queue.atRisk.length}>
              {queue.atRisk.map((account) => (
                <Card key={account.id} tone={account.suspended ? "bad" : "warn"}>
                  <p className="font-body font-medium text-[12.5px]" style={{ color: "#fff" }}>
                    {account.email ?? account.id}
                  </p>
                  <p className="font-body font-light text-[11.5px] mt-1" style={{ color: MUTED }}>
                    {account.lateCancellations} late cancellation
                    {account.lateCancellations === 1 ? "" : "s"} in 90 days ·{" "}
                    {account.suspended ? "new bookings paused" : "one more pauses new bookings"}
                  </p>
                </Card>
              ))}
            </Panel>

            <Panel title="Hosts who cannot be paid" count={queue.unpayableHosts.length}>
              {queue.unpayableHosts.map((host) => (
                <Card key={host.id} tone="warn">
                  <p className="font-body font-medium text-[12.5px]" style={{ color: "#fff" }}>
                    {host.email ?? host.id}
                  </p>
                  <p className="font-body font-light text-[11.5px] mt-1" style={{ color: MUTED }}>
                    {host.owedSessions} session{host.owedSessions === 1 ? "" : "s"} ·{" "}
                    {formatCents(host.owedCents)} waiting · no Stripe payout account
                  </p>
                </Card>
              ))}
            </Panel>
          </div>

          <div className="flex flex-col gap-4">
            <Panel title="Listings waiting for review" count={queue.pendingListings.length}>
              {queue.pendingListings.map((listing) => (
                <Card key={listing.id}>
                  <p className="font-body font-medium text-[12.5px]" style={{ color: "#fff" }}>
                    {listing.name}
                  </p>
                  <p className="font-body font-light text-[11.5px] mt-1" style={{ color: MUTED }}>
                    {listing.category} · {formatCents(listing.hourlyRateCents)}/hr ·{" "}
                    {listing.hostEmail ?? "unknown host"}
                  </p>
                  {listing.addressLine && (
                    <p
                      className="font-body font-light text-[11px] mt-1"
                      style={{ color: "#7C93AC" }}
                    >
                      {listing.addressLine}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2 mt-3">
                    {listing.subleaseDocPath ? (
                      <Doc
                        label="Sublease proof"
                        onClick={() => void openDocument(listing.subleaseDocPath!)}
                      />
                    ) : (
                      <span className="font-body text-[11px]" style={{ color: CORAL }}>
                        No document — cannot be approved
                      </span>
                    )}
                    {listing.insuranceDocPath && (
                      <Doc
                        label="Insurance"
                        onClick={() => void openDocument(listing.insuranceDocPath!)}
                      />
                    )}
                  </div>

                  <div className="flex gap-2 mt-3">
                    <Action
                      primary
                      disabled={busy === listing.id || !listing.subleaseDocPath}
                      onClick={() => void act("approve_listing", listing.id)}
                    >
                      <Check size={12} /> Approve
                    </Action>
                    <Action
                      disabled={busy === listing.id}
                      onClick={() => void act("reject_listing", listing.id)}
                    >
                      <X size={12} /> Reject
                    </Action>
                  </div>
                </Card>
              ))}
            </Panel>

            <Panel title="Account change requests" count={queue.accountChangeRequests.length}>
              {queue.accountChangeRequests.map((request) => (
                <Card key={request.id}>
                  <p className="font-body font-medium text-[12.5px]" style={{ color: "#fff" }}>
                    {request.email ?? "unknown"} — {request.from} → {request.to}
                  </p>
                  {request.reason && (
                    <p
                      className="font-body font-light text-[11.5px] mt-1.5 leading-relaxed"
                      style={{ color: "#C7D6E6" }}
                    >
                      &ldquo;{request.reason}&rdquo;
                    </p>
                  )}
                  <div className="mt-3">
                    <Action
                      primary
                      disabled={busy === request.id}
                      onClick={() => void act("approve_account_change", request.id)}
                    >
                      Approve the switch
                    </Action>
                  </div>
                </Card>
              ))}
            </Panel>

            <Panel title="Everything, newest first" count={queue.activity.length}>
              {queue.activity.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-2.5 py-1.5"
                  style={{ borderBottom: `1px solid ${LINE}` }}
                >
                  <span
                    className="shrink-0 mt-1.5"
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 99,
                      backgroundColor: activityColour(entry.kind),
                    }}
                  />
                  <div className="min-w-0">
                    <p className="font-body text-[11.5px]" style={{ color: "#fff" }}>
                      {entry.text}
                    </p>
                    <p className="font-body font-light text-[10px]" style={{ color: MUTED }}>
                      {new Date(entry.at).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
              ))}
            </Panel>
          </div>
        </div>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */

/** One colour per kind, so the feed can be scanned without reading it. */
function activityColour(kind: string): string {
  if (kind === "cancellation") return CORAL;
  if (kind === "review") return "#E8A33D";
  if (kind === "listing") return "#4ADE80";
  if (kind === "message") return "#9B8AFB";
  return SKY;
}

/** Says when the numbers were last true, which is the only honest "live". */
function LiveDot({ updatedAt, onRefresh }: { updatedAt: Date | null; onRefresh: () => void }) {
  /**
   * The clock is state, not a read during render.
   *
   * `Date.now()` in the render body makes the component's output depend on
   * when React happened to run it, so the label can jump or stall for reasons
   * nothing on screen explains. Ticked once a second instead, which is also
   * what stops "8s ago" being a claim that quietly ages into a lie.
   */
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    // First tick on the interval rather than immediately: a setState in the
    // effect body re-renders before anything has happened, and a second of
    // "connecting" on a screen that refreshes every twenty is not a cost.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const seconds =
    updatedAt && now !== null ? Math.floor((now - updatedAt.getTime()) / 1000) : null;

  return (
    <button
      type="button"
      onClick={onRefresh}
      className="flex items-center gap-2 px-3.5 py-2 rounded-full font-body text-[11.5px] press"
      style={{ backgroundColor: PANEL, color: MUTED, border: `1px solid ${LINE}` }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: 99,
          backgroundColor: "#4ADE80",
          boxShadow: "0 0 0 3px rgba(74,222,128,0.18)",
        }}
      />
      {seconds === null ? "connecting" : seconds < 5 ? "live" : `${seconds}s ago`}
    </button>
  );
}

function Stat({
  label,
  value,
  strong = false,
  icon: Icon,
}: {
  label: string;
  value: string;
  strong?: boolean;
  icon?: typeof Users;
}) {
  return (
    <div
      className="rounded-xl px-4 py-3.5"
      style={{
        backgroundColor: PANEL,
        border: `1px solid ${strong ? "rgba(59,155,232,0.35)" : LINE}`,
      }}
    >
      <p
        className="font-body font-light text-[10px] uppercase tracking-wide flex items-center gap-1.5"
        style={{ color: MUTED }}
      >
        {Icon && <Icon size={11} />} {label}
      </p>
      <p
        className="font-body font-semibold mt-1"
        style={{ color: strong ? SKY : "#fff", fontSize: strong ? 22 : 19 }}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * Fourteen days of bookings.
 *
 * Drawn with divs rather than a charting library: it is one series of small
 * integers, and a library would be a few hundred kilobytes and a second
 * rendering model for a row of rectangles.
 */
function Chart({ days }: { days: AdminQueue["bookingsByDay"] }) {
  const peak = Math.max(1, ...days.map((d) => d.bookings));

  return (
    <section
      className="rounded-xl px-4 py-4 mt-3"
      style={{ backgroundColor: PANEL, border: `1px solid ${LINE}` }}
    >
      <p
        className="font-body font-light text-[10px] uppercase tracking-wide"
        style={{ color: MUTED }}
      >
        Bookings · last 14 days
      </p>
      <div className="flex items-end gap-1.5 mt-3" style={{ height: 78 }}>
        {days.map((day) => (
          <div key={day.day} className="flex-1 flex flex-col items-center justify-end gap-1.5">
            <span
              className="font-body text-[9px]"
              style={{ color: day.bookings ? "#fff" : "transparent" }}
            >
              {day.bookings}
            </span>
            <div
              title={`${day.day}: ${day.bookings}`}
              style={{
                width: "100%",
                // A quiet day still gets a sliver, so the axis reads as
                // fourteen days rather than however many had a booking.
                height: `${Math.max(3, (day.bookings / peak) * 52)}px`,
                borderRadius: 3,
                backgroundColor: day.bookings ? SKY : "rgba(255,255,255,0.08)",
              }}
            />
            <span className="font-body text-[9px]" style={{ color: MUTED }}>
              {new Date(day.day).getUTCDate()}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Panel({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-xl px-4 py-4"
      style={{ backgroundColor: PANEL, border: `1px solid ${LINE}` }}
    >
      <p
        className="font-body font-medium text-[10px] uppercase tracking-[0.14em]"
        style={{ color: SKY }}
      >
        {title} · {count}
      </p>
      {count === 0 ? (
        <p className="font-body font-light text-[11.5px] mt-2" style={{ color: MUTED }}>
          Nothing here.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5 mt-3">{children}</div>
      )}
    </section>
  );
}

function Card({
  tone = "plain",
  children,
}: {
  tone?: "plain" | "bad" | "warn";
  children: React.ReactNode;
}) {
  const border =
    tone === "bad" ? "rgba(242,105,92,0.45)" : tone === "warn" ? "rgba(232,163,61,0.4)" : LINE;

  return (
    <div
      className="rounded-lg px-3.5 py-3"
      style={{ backgroundColor: BG, border: `1px solid ${border}` }}
    >
      {children}
    </div>
  );
}

function Doc({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md font-body text-[11px] press"
      style={{ backgroundColor: "rgba(59,155,232,0.14)", color: "#9CCBF3" }}
    >
      <FileText size={11} /> {label}
    </button>
  );
}

function Action({
  children,
  onClick,
  disabled,
  primary = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 px-3.5 py-2 rounded-full font-body font-medium text-[11.5px] press"
      style={
        primary
          ? { backgroundColor: disabled ? "#2A4763" : SKY, color: "#fff" }
          : { border: `1px solid ${LINE}`, color: MUTED }
      }
    >
      {children}
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
        className="flex-1 px-3 py-2 rounded-md font-body text-[11.5px] outline-none"
        style={{ backgroundColor: PANEL, color: "#fff", border: `1px solid ${LINE}` }}
      />
      <Action primary disabled={busy} onClick={() => onResolve(note)}>
        {busy ? "…" : "Resolve"}
      </Action>
    </div>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-2 mt-4 px-4 py-3 rounded-xl font-body text-[12px]"
      style={{
        backgroundColor: "rgba(242,105,92,0.12)",
        border: "1px solid rgba(242,105,92,0.35)",
        color: "#FFB4AC",
      }}
    >
      {children}
    </div>
  );
}
