"use client";

import {
  AlertTriangle,
  Archive,
  Building2,
  CalendarClock,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  FileText,
  Phone,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { errorMessage } from "@/lib/error-message";
import type {
  AdminQueue,
  ListingRow,
  LiveSession,
  PendingInsurance,
  Person,
  SessionParty,
} from "@/lib/admin/queue";
import { formatCents } from "@/lib/money";
import { isVerificationDocPath } from "@/lib/verification-docs";

import { DisputeQueue } from "./disputes";
import { Funnel } from "./funnel";
import { MoneyChart } from "./money-chart";

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
        setError(errorMessage(failure, "Could not load the queue"));
      }
    };

    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [revision]);

  const act = async (
    action: string,
    id: string,
    note?: string,
    /** Whatever else the action needs — an outcome, a verdict, an amount. */
    extra?: Record<string, unknown>,
  ) => {
    setBusy(id);
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id, note, ...extra }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "That did not work");
      reload();
    } catch (failure) {
      setError(errorMessage(failure, "That did not work"));
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
    ...(counts.hostsUnpaid > 0
      ? [
          {
            key: "hostsUnpaid",
            text: `${counts.hostsUnpaid} finished session${
              counts.hostsUnpaid === 1 ? "" : "s"
            } the studio has not been paid for`,
          },
        ]
      : []),
  ];

  const nothingWaiting =
    urgent.length === 0 &&
    queue.escalations.length === 0 &&
    queue.pendingListings.length === 0 &&
    queue.pendingInsurance.length === 0 &&
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

        <div
          className="grid gap-3 mt-3"
          style={{ gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}
        >
          <Chart days={queue.bookingsByDay} />
          <MoneyChart days={queue.moneyByDay} />
          <Funnel steps={queue.funnel} />
        </div>

        <InTheRoom sessions={queue.liveSessions} />

        <Directory people={queue.people} listings={queue.listings} act={act} busy={busy} />

        <div
          className="grid gap-4 mt-6"
          style={{ gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))" }}
        >
          <div className="flex flex-col gap-4">
            {/*
              First in the column, because it is the only panel where somebody
              is waiting on us for money rather than for a decision about a
              listing. Safety reports inside it are sorted to the top.
            */}
            <Panel
              title="Refunds and claims"
              count={queue.openDisputes.filter((d) => d.waitingOn === "us").length}
            >
              <DisputeQueue
                disputes={queue.openDisputes}
                busy={busy}
                onDecide={(dispute, outcome, note, amountCents) => {
                  if (dispute.kind === "refund") {
                    void act("decide_refund", dispute.id, note, { outcome });
                  } else {
                    void act("decide_claim", dispute.id, note, {
                      verdict: outcome,
                      ...(amountCents ? { amountCents } : {}),
                    });
                  }
                }}
              />
            </Panel>

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
            <Panel title="Why each listing is waiting" count={queue.reviewReasons.length}>
              {queue.reviewReasons.map((item) => (
                <Card key={item.id} tone={item.subleaseState === "rejected" ? "bad" : "plain"}>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-body font-medium text-[12px]" style={{ color: "#fff" }}>
                      {item.name}
                    </p>
                    {/*
                      A listing that was live until its host moved it is not a
                      new listing. Same status, different job — this one was
                      approved once and the question is what changed.
                    */}
                    <span
                      className="shrink-0 px-2 py-0.5 rounded-full font-body text-[10px]"
                      style={
                        item.returning
                          ? { backgroundColor: "rgba(232,163,61,0.16)", color: "#E8A33D" }
                          : { backgroundColor: "rgba(255,255,255,0.06)", color: MUTED }
                      }
                    >
                      {item.returning ? "back for review" : "new"}
                    </span>
                  </div>

                  {/*
                    What the operator is actually being asked to look at. The
                    badge says a listing came back; this says why, which is the
                    part that decides where to look — a studio that moved across
                    town needs its new address checked against a lease, and one
                    that changed its room type does not.
                  */}
                  {item.changed && (
                    <p
                      className="font-body font-medium text-[11px] mt-1"
                      style={{ color: "#E8A33D" }}
                    >
                      {item.changed} changed
                    </p>
                  )}
                  {item.previousAddress && (
                    <p className="font-body font-light text-[11px]" style={{ color: MUTED }}>
                      was: {item.previousAddress}
                    </p>
                  )}
                  <p className="font-body font-light text-[11px] mt-0.5" style={{ color: MUTED }}>
                    {item.hostEmail ?? "unknown host"} · lease {item.subleaseState} · insurance{" "}
                    {item.insuranceState}
                  </p>
                  {item.note && (
                    <p className="font-body font-light text-[11px] mt-1" style={{ color: "#F2A79E" }}>
                      {item.note}
                    </p>
                  )}
                </Card>
              ))}
            </Panel>

            <Panel title="Live listings missing something" count={queue.listingGaps.length}>
              {queue.listingGaps.map((gap) => (
                <Card key={gap.id} tone="warn">
                  <p className="font-body font-medium text-[12px]" style={{ color: "#fff" }}>
                    {gap.name}
                  </p>
                  {/*
                    Named individually rather than scored. "Listing quality 60%"
                    tells an operator nothing they can put in a message to a
                    host; "no photos, no open hours" tells them exactly what.
                  */}
                  <p className="font-body font-light text-[11px] mt-0.5" style={{ color: MUTED }}>
                    {gap.missing.join(" · ")}
                  </p>
                  <p className="font-body font-light text-[11px]" style={{ color: MUTED }}>
                    {gap.hostEmail ?? "unknown host"}
                  </p>
                </Card>
              ))}
            </Panel>

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

            <Panel title="Insurance waiting for review" count={queue.pendingInsurance.length}>
              {queue.pendingInsurance.map((item) => (
                <InsuranceReviewCard
                  key={item.id}
                  item={item}
                  busy={busy === item.id}
                  onView={() => item.docPath && void openDocument(item.docPath)}
                  onVerify={(fields) => void act("verify_insurance", item.id, undefined, fields)}
                  onReject={(note) => void act("reject_insurance", item.id, note)}
                />
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

/**
 * Who and what, behind every number on this page.
 *
 * A count answers nothing on its own — "1 listing" tells an operator there is
 * work without telling them whose, and the next thing they do is go looking in
 * the database. So both directories are here, searchable, and a row opens into
 * everything already known about that person or that room.
 *
 * Expanded in place rather than routed to. The detail is read at the same
 * moment as the row above it, from the same fetch, so the two can never
 * disagree about what is true — which a separate detail page could.
 */
/**
 * Sessions happening right now, and who to call about them.
 *
 * Everything else on this page is history. This is the only part where
 * somebody is currently in a building, and it is the only reason the app asks
 * for an emergency contact at all — a field collected and then unreachable is
 * a field that does nothing.
 *
 * Both sides are shown, not only the practitioner. A host who let a stranger
 * into their studio is in the same position as a practitioner alone in one.
 *
 * Silent when nothing is running. An empty panel here every day is the point:
 * it means nobody needs anything.
 */
function InTheRoom({ sessions }: { sessions: LiveSession[] }) {
  if (sessions.length === 0) return null;

  const clock = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  return (
    <div
      className="rounded-xl p-4 mt-6"
      style={{ backgroundColor: PANEL, border: `1px solid ${LINE}` }}
    >
      <div className="flex items-center gap-2">
        <span
          className="rounded-full"
          style={{ width: 7, height: 7, backgroundColor: "#E8613D" }}
        />
        <p className="font-body font-medium text-[12.5px]" style={{ color: "#fff" }}>
          In a room now
        </p>
        <span className="font-body font-light text-[11px]" style={{ color: MUTED }}>
          {sessions.length}
        </span>
      </div>

      <div className="flex flex-col gap-2.5 mt-3">
        {sessions.map((session) => (
          <div
            key={session.bookingId}
            className="rounded-lg p-3"
            style={{ backgroundColor: BG, border: `1px solid ${LINE}` }}
          >
            <div className="flex items-baseline gap-2 flex-wrap">
              <p className="font-body font-medium text-[12.5px]" style={{ color: "#fff" }}>
                {session.spaceName}
              </p>
              <span
                className="px-2 py-0.5 rounded-full font-body text-[10px]"
                style={{
                  backgroundColor:
                    session.state === "in progress"
                      ? "rgba(232,97,61,0.16)"
                      : "rgba(255,255,255,0.06)",
                  color: session.state === "in progress" ? "#E8613D" : MUTED,
                }}
              >
                {session.state}
              </span>
              <span className="font-body font-light text-[11px]" style={{ color: MUTED }}>
                {clock(session.startsAt)}-{clock(session.endsAt)}
              </span>
            </div>

            {session.addressLine && (
              <p className="font-body font-light text-[11px] mt-0.5" style={{ color: MUTED }}>
                {session.addressLine}
              </p>
            )}

            <div
              className="grid gap-3 mt-2.5"
              style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}
            >
              <Party role="Practitioner" party={session.practitioner} />
              <Party role="Studio" party={session.host} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** One side of a session, with the number to ring if it goes wrong. */
function Party({ role, party }: { role: string; party: SessionParty }) {
  const reachable = Boolean(party.emergency.phone?.trim() || party.emergency.name?.trim());

  return (
    <div>
      <p
        className="font-body font-light text-[9.5px] uppercase tracking-[0.1em]"
        style={{ color: MUTED }}
      >
        {role}
      </p>
      <p className="font-body text-[11.5px]" style={{ color: "#fff" }}>
        {party.name ?? party.email ?? "No name"}
      </p>

      <div className="flex items-center gap-1.5 mt-1">
        <Phone size={10} color={reachable ? "#E8A33D" : MUTED} className="shrink-0" />
        <p
          className="font-body text-[11px]"
          style={{ color: reachable ? "#E8A33D" : MUTED }}
        >
          {emergencyLine(party.emergency)}
        </p>
      </div>
    </div>
  );
}

function Directory({
  people,
  listings,
  act,
  busy,
}: {
  people: Person[];
  listings: ListingRow[];
  act: (action: string, id: string) => void | Promise<void>;
  busy: string | null;
}) {
  const [tab, setTab] = useState<"people" | "listings">("people");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  // Arms a two-click action: the first click sets this to the listing's id, the
  // second confirms. Reset whenever a row is toggled, so neither can linger.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null);

  const term = query.trim().toLowerCase();
  const match = (...fields: (string | null)[]) =>
    term === "" || fields.some((field) => (field ?? "").toLowerCase().includes(term));

  const shownPeople = people.filter((person) =>
    match(person.email, person.displayName, person.accountType),
  );
  const shownListings = listings.filter((listing) =>
    match(listing.name, listing.hostEmail, listing.status, listing.category, listing.addressLine),
  );

  const total = tab === "people" ? shownPeople.length : shownListings.length;
  const date = (value: string | null) =>
    value
      ? new Date(value).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "unknown";

  return (
    <section
      className="rounded-xl px-4 py-4 mt-3"
      style={{ backgroundColor: PANEL, border: `1px solid ${LINE}` }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Tab
          label="People"
          active={tab === "people"}
          count={people.length}
          onClick={() => {
            setTab("people");
            setOpenId(null);
          }}
        />
        <Tab
          label="Listings"
          active={tab === "listings"}
          count={listings.length}
          onClick={() => {
            setTab("listings");
            setOpenId(null);
          }}
        />

        <div
          className="flex items-center gap-1.5 ml-auto rounded-lg px-2.5 py-1.5"
          style={{ backgroundColor: BG, border: `1px solid ${LINE}` }}
        >
          <Search size={12} color={MUTED} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tab === "people" ? "email or name" : "room, host or address"}
            className="font-body text-[11.5px] bg-transparent outline-none"
            style={{ color: "#fff", width: 170 }}
          />
        </div>
      </div>

      {total === 0 ? (
        <p className="font-body font-light text-[11.5px] mt-3" style={{ color: MUTED }}>
          {term !== ""
            ? "Nothing matching that."
            : tab === "people"
              ? "Nobody yet."
              : "No rooms listed yet."}
        </p>
      ) : (
        <div className="flex flex-col mt-3">
          {tab === "people"
            ? shownPeople.map((person) => (
                <Row
                  key={person.id}
                  open={openId === person.id}
                  onToggle={() => setOpenId(openId === person.id ? null : person.id)}
                  title={person.displayName ?? person.email ?? "No name yet"}
                  subtitle={person.displayName ? person.email : null}
                  tag={person.accountType ?? "no type"}
                  right={`${person.sessions} ${person.sessions === 1 ? "session" : "sessions"}`}
                  alert={person.payoutsReady === false && person.earnedCents > 0}
                  details={[
                    ["Signed up", date(person.joinedAt)],
                    ["Sessions", String(person.sessions)],
                    person.accountType === "host"
                      ? ["Earned", formatCents(person.earnedCents)]
                      : ["Spent", formatCents(person.spentCents)],
                    ["Listings", String(person.listings)],
                    [
                      "Late cancellations",
                      person.lateCancellations === 0 ? "none" : String(person.lateCancellations),
                    ],
                    person.payoutsReady === null
                      ? ["Payouts", "not applicable"]
                      : ["Payouts", person.payoutsReady ? "ready" : "not set up"],
                    /*
                     * The one thing on this screen that is read in a hurry.
                     * Written out rather than reduced to "on file", because
                     * the moment it is needed is not the moment to go looking
                     * for a second screen.
                     */
                    ["Emergency contact", emergencyLine(person.emergency)],
                    ["Account id", person.id],
                  ]}
                />
              ))
            : shownListings.map((listing) => (
                <Row
                  key={listing.id}
                  open={openId === listing.id}
                  onToggle={() => {
                    setOpenId(openId === listing.id ? null : listing.id);
                    setConfirmDelete(null);
                    setConfirmArchive(null);
                  }}
                  title={listing.name}
                  subtitle={listing.hostEmail}
                  tag={listing.archivedAt ? "archived" : listing.status}
                  right={`${listing.sessions} ${listing.sessions === 1 ? "session" : "sessions"}`}
                  alert={listing.status === "pending"}
                  details={[
                    ["Host", listing.hostEmail ?? "unknown"],
                    ["Status", listing.archivedAt ? "closed (archived)" : listing.status],
                    ["Type", listing.category || "unset"],
                    ["Host rate", `${formatCents(listing.hourlyRateCents)}/hr`],
                    ["Sessions", String(listing.sessions)],
                    ["Paid to host", formatCents(listing.earnedCents)],
                    /*
                     * The address is on this screen and nowhere else. An
                     * operator has to be able to find a room; a practitioner
                     * who has not booked it still cannot see this.
                     */
                    ["Address", listing.addressLine ?? "not set"],
                    ["Listed", date(listing.createdAt)],
                    ["Listing id", listing.id],
                  ]}
                  actions={
                    <div className="flex flex-wrap gap-2 pb-3 pl-6">
                      {/* Hold / resume — the reversible pair, not offered once a
                          listing has been closed for good. */}
                      {!listing.archivedAt &&
                        (listing.status === "delisted" ? (
                          <Action
                            disabled={busy === listing.id}
                            onClick={() => void act("relist_listing", listing.id)}
                          >
                            <Eye size={12} /> Put back on the site
                          </Action>
                        ) : (
                          <Action
                            disabled={busy === listing.id}
                            onClick={() => void act("delist_listing", listing.id)}
                          >
                            <EyeOff size={12} /> Hold — take off the site
                          </Action>
                        ))}

                      {/* Close for good — off the site, no new bookings, record
                          kept. Two-click, and gone once it is already archived. */}
                      {!listing.archivedAt &&
                        (confirmArchive === listing.id ? (
                          <Action
                            disabled={busy === listing.id}
                            onClick={() => void act("archive_listing", listing.id)}
                          >
                            <Archive size={12} /> Confirm — close for good
                          </Action>
                        ) : (
                          <Action onClick={() => setConfirmArchive(listing.id)}>
                            <Archive size={12} /> Close permanently
                          </Action>
                        ))}

                      {/* Hard delete — cleanup, only for a listing nobody ever
                          booked. The bookings FK refuses the rest at the database. */}
                      {listing.sessions === 0 ? (
                        confirmDelete === listing.id ? (
                          <Action
                            danger
                            disabled={busy === listing.id}
                            onClick={() => void act("delete_listing", listing.id)}
                          >
                            <Trash2 size={12} /> Confirm — delete for good
                          </Action>
                        ) : (
                          <Action danger onClick={() => setConfirmDelete(listing.id)}>
                            <Trash2 size={12} /> Delete permanently
                          </Action>
                        )
                      ) : (
                        !listing.archivedAt && (
                          <span
                            className="font-body text-[10.5px] self-center"
                            style={{ color: MUTED }}
                          >
                            Has bookings — hold or close it, it cannot be deleted
                          </span>
                        )
                      )}
                    </div>
                  }
                />
              ))}
        </div>
      )}
    </section>
  );
}

function Tab({
  label,
  active,
  count,
  onClick,
}: {
  label: string;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1.5 rounded-lg font-body font-medium text-[11.5px] press"
      style={{
        backgroundColor: active ? "rgba(59,155,232,0.18)" : BG,
        color: active ? "#9CCBF3" : MUTED,
        border: `1px solid ${active ? "rgba(59,155,232,0.4)" : LINE}`,
      }}
    >
      {label} · {count}
    </button>
  );
}

/** One line, and everything about it one click away. */
/**
 * An emergency contact as one readable line.
 *
 * "Not filled in" is said plainly rather than left blank. A blank cell reads as
 * a rendering fault; the absence is real information, and it is the kind that
 * is otherwise discovered at the worst possible moment.
 *
 * A partial answer is shown as far as it goes — a phone number with no name is
 * still a phone number, and dropping it for being incomplete helps nobody.
 */
function emergencyLine(contact: Person["emergency"]): string {
  const parts = [contact.name, contact.phone].filter((v): v is string => Boolean(v?.trim()));
  if (parts.length === 0) return "not filled in";

  const line = parts.join(" · ");
  return contact.relationship?.trim() ? `${line} (${contact.relationship.trim()})` : line;
}

function Row({
  open,
  onToggle,
  title,
  subtitle,
  tag,
  right,
  alert,
  details,
  actions,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  subtitle: string | null;
  tag: string;
  right: string;
  alert: boolean;
  details: [string, string][];
  /** Buttons shown under the details when the row is open. */
  actions?: React.ReactNode;
}) {
  return (
    <div style={{ borderBottom: `1px solid ${LINE}` }}>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2.5 w-full text-left py-2.5"
      >
        <ChevronRight
          size={12}
          color={MUTED}
          style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 140ms" }}
          className="shrink-0"
        />
        <div className="min-w-0 flex-1">
          <p className="font-body text-[12px] truncate" style={{ color: "#fff" }}>
            {title}
          </p>
          {subtitle && (
            <p className="font-body font-light text-[10.5px] truncate" style={{ color: MUTED }}>
              {subtitle}
            </p>
          )}
        </div>
        <span
          className="shrink-0 px-2 py-0.5 rounded-full font-body text-[10px]"
          style={{
            backgroundColor: alert ? "rgba(232,163,61,0.16)" : "rgba(255,255,255,0.06)",
            color: alert ? "#E8A33D" : MUTED,
          }}
        >
          {tag}
        </span>
        <span
          className="shrink-0 font-body text-[11px] text-right"
          style={{ color: MUTED, width: 76 }}
        >
          {right}
        </span>
      </button>

      {open && (
        <>
          <div
            className="grid gap-x-4 gap-y-1.5 pb-3 pl-6"
            style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}
          >
            {details.map(([label, value]) => (
              <div key={label}>
                <p
                  className="font-body font-light text-[9.5px] uppercase tracking-[0.1em]"
                  style={{ color: MUTED }}
                >
                  {label}
                </p>
                <p className="font-body text-[11.5px] break-words" style={{ color: "#fff" }}>
                  {value}
                </p>
              </div>
            ))}
          </div>
          {actions}
        </>
      )}
    </div>
  );
}

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
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
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
          : danger
            ? { border: `1px solid ${CORAL}`, color: CORAL }
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

/**
 * Reading a certificate and turning it into a decision.
 *
 * Verifying is not a single click on purpose: the window is the decision. Staff
 * read the two dates off the certificate and type them, because the booking
 * gate refuses a verified row that carries none, and a one-tap "looks fine"
 * would produce exactly that row. Rejecting takes a reason, shown to the
 * professional the same way a listing rejection reaches a host.
 */
function InsuranceReviewCard({
  item,
  busy,
  onView,
  onVerify,
  onReject,
}: {
  item: PendingInsurance;
  busy: boolean;
  onView: () => void;
  onVerify: (fields: {
    effectiveDate: string;
    expiresAt: string;
    insurer: string;
    policyNumber: string;
  }) => void;
  onReject: (note: string) => void;
}) {
  const [effectiveDate, setEffectiveDate] = useState(item.effectiveDate ?? "");
  const [expiresAt, setExpiresAt] = useState(item.expiresAt ?? "");
  const [insurer, setInsurer] = useState(item.insurer ?? "");
  const [policyNumber, setPolicyNumber] = useState(item.policyNumber ?? "");
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");

  const field = "flex-1 px-3 py-2 rounded-md font-body text-[11.5px] outline-none";
  const fieldStyle = { backgroundColor: PANEL, color: "#fff", border: `1px solid ${LINE}` };
  const canVerify = /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) && /^\d{4}-\d{2}-\d{2}$/.test(expiresAt);

  /*
   * A certificate added before document storage existed has a bare filename in
   * insurance_doc_path and no object behind it. It can be named but never
   * opened, so it cannot be reviewed — the practitioner has to add it again
   * (their "Replace file" writes a real path and returns this to pending). Same
   * rule the signing route enforces, so what the admin sees matches what opens.
   */
  const legacyDoc = item.docPath !== null && !isVerificationDocPath(item.docPath);

  return (
    <Card>
      <p className="font-body font-medium text-[12.5px]" style={{ color: "#fff" }}>
        {item.displayName ?? item.email ?? "A professional"}
      </p>
      <p className="font-body font-light text-[11.5px] mt-1" style={{ color: MUTED }}>
        {item.email ?? "unknown"}
      </p>

      <div className="mt-3">
        {!item.docPath ? (
          <span className="font-body text-[11px]" style={{ color: CORAL }}>
            No file uploaded
          </span>
        ) : legacyDoc ? (
          <div>
            <span className="font-body font-medium text-[11.5px]" style={{ color: CORAL }}>
              Document unavailable
            </span>
            <p className="font-body font-light text-[11px] mt-1" style={{ color: MUTED }}>
              This certificate was added before document storage was enabled. Ask the
              practitioner to upload it again.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Doc label="Certificate" onClick={onView} />
          </div>
        )}
      </div>

      {rejecting ? (
        <div className="flex gap-2 mt-3">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why is it being turned down? (shown to them)"
            aria-label="Rejection reason"
            className={field}
            style={fieldStyle}
          />
          <Action danger disabled={busy || note.trim().length < 15} onClick={() => onReject(note)}>
            {busy ? "…" : "Confirm"}
          </Action>
          <Action disabled={busy} onClick={() => setRejecting(false)}>
            Cancel
          </Action>
        </div>
      ) : (
        <>
          <div className="flex gap-2 mt-3">
            <input
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              placeholder="Effective (YYYY-MM-DD)"
              aria-label="Effective date"
              className={field}
              style={fieldStyle}
            />
            <input
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              placeholder="Expires (YYYY-MM-DD)"
              aria-label="Expiry date"
              className={field}
              style={fieldStyle}
            />
          </div>
          <div className="flex gap-2 mt-2">
            <input
              value={insurer}
              onChange={(e) => setInsurer(e.target.value)}
              placeholder="Insurer (optional)"
              aria-label="Insurer"
              className={field}
              style={fieldStyle}
            />
            <input
              value={policyNumber}
              onChange={(e) => setPolicyNumber(e.target.value)}
              placeholder="Policy no. (optional)"
              aria-label="Policy number"
              className={field}
              style={fieldStyle}
            />
          </div>
          <div className="flex gap-2 mt-3">
            <Action
              primary
              disabled={busy || !canVerify || legacyDoc}
              onClick={() => onVerify({ effectiveDate, expiresAt, insurer, policyNumber })}
            >
              <Check size={12} /> Verify
            </Action>
            <Action disabled={busy} onClick={() => setRejecting(true)}>
              <X size={12} /> Reject
            </Action>
          </div>
        </>
      )}
    </Card>
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
