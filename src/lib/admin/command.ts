/**
 * The Command home, projected from the one queue read.
 *
 * Pure so it is testable and cannot drift: it takes the AdminQueue that
 * loadQueue already builds and shapes the founder's first screen — the KPIs that
 * answer "what is happening", the health bar (only states we can actually
 * derive), the ranked "needs attention" list (safety and money first), and the
 * live/activity slices. Nothing here invents a number: a metric we do not yet
 * track is marked absent (null) rather than shown as a misleading zero.
 */

import type { ActivityEntry, AdminQueue, LiveSession } from "./queue";

export interface Kpi {
  key: string;
  label: string;
  /** null means "not instrumented yet" — never conflated with a real 0. */
  value: number | null;
  format: "money" | "count";
  strong?: boolean;
  sub?: string;
}

export interface HealthItem {
  key: string;
  label: string;
  state: "healthy" | "attention" | "critical" | "unknown";
  note?: string;
}

export interface AttentionItem {
  key: string;
  label: string;
  count: number;
  href: string;
  tone: "bad" | "warn";
}

export interface CommandView {
  urgentCount: number;
  kpis: Kpi[];
  health: HealthItem[];
  needsAttention: AttentionItem[];
  queuesTotal: number;
  queuesClear: boolean;
  liveSessions: LiveSession[];
  activity: ActivityEntry[];
}

/**
 * System health, only where it can actually be measured.
 *
 * The queue read having succeeded is real evidence the database and the
 * service-role auth admin are reachable; the notification outbox is real
 * evidence of delivery. Everything else — Stripe, web analytics — has no probe
 * yet, so it is "unknown", never a reassuring green we cannot back up. Shared by
 * Command and System so the two never disagree about whether anything is on fire.
 */
export function deriveHealth(q: AdminQueue): HealthItem[] {
  const failedGivenUp = q.failedNotifications.filter((n) => n.givenUp).length;
  return [
    { key: "database", label: "Database", state: "healthy" },
    { key: "auth", label: "Auth", state: "healthy" },
    {
      key: "notifications",
      label: "Notifications",
      state: failedGivenUp > 0 ? "attention" : "healthy",
      note: failedGivenUp > 0 ? `${failedGivenUp} gave up` : undefined,
    },
    { key: "stripe_payments", label: "Stripe payments", state: "unknown" },
    { key: "stripe_payouts", label: "Stripe Connect payouts", state: "unknown" },
    { key: "web_analytics", label: "Web analytics", state: "unknown", note: "not instrumented yet" },
  ];
}

export function commandView(q: AdminQueue): CommandView {
  const disputesOnUs = q.openDisputes.filter((d) => d.waitingOn === "us").length;
  const failedGivenUp = q.failedNotifications.filter((n) => n.givenUp).length;

  // Ranked by who is hurt while nobody looks: safety, then money, then the rest.
  const candidates: AttentionItem[] = [
    { key: "safety", label: "Safety & low ratings", count: q.escalations.length, href: "/admin/trust", tone: "bad" },
    { key: "disputes", label: "Refunds & claims waiting on us", count: disputesOnUs, href: "/admin/trust", tone: "bad" },
    { key: "unpayable", label: "Hosts who cannot be paid", count: q.unpayableHosts.length, href: "/admin/trust", tone: "warn" },
    { key: "failed", label: "Messages that failed for good", count: failedGivenUp, href: "/admin/trust", tone: "bad" },
    { key: "insurance", label: "Insurance waiting for review", count: q.pendingInsurance.length, href: "/admin/trust", tone: "warn" },
    { key: "credentials", label: "Credentials waiting for review", count: q.pendingCredentials.length, href: "/admin/trust", tone: "warn" },
    { key: "listings", label: "Listings waiting for review", count: q.pendingListings.length, href: "/admin/trust", tone: "warn" },
    { key: "account_changes", label: "Account change requests", count: q.accountChangeRequests.length, href: "/admin/trust", tone: "warn" },
    { key: "at_risk", label: "Accounts at risk", count: q.atRisk.length, href: "/admin/trust", tone: "warn" },
  ];
  const needsAttention = candidates.filter((c) => c.count > 0);

  // Urgent = the safety/money slice worth a badge, not the whole backlog.
  const urgentCount = q.escalations.length + disputesOnUs + q.unpayableHosts.length + failedGivenUp;

  const kpis: Kpi[] = [
    { key: "platform_month", label: "Our revenue · this month", value: q.money.platformCents, format: "money", strong: true },
    { key: "gmv_month", label: "Booking volume · this month", value: q.money.grossCents, format: "money", sub: "what practitioners paid (not our revenue)" },
    { key: "host_month", label: "Paid to hosts · this month", value: q.money.hostCents, format: "money" },
    { key: "platform_all", label: "Our revenue · all time", value: q.money.platformAllTimeCents, format: "money" },
    { key: "sessions_month", label: "Sessions · this month", value: q.counts.sessionsThisMonth, format: "count" },
    { key: "upcoming", label: "Upcoming sessions", value: q.counts.upcomingSessions, format: "count" },
    { key: "live_listings", label: "Live listings", value: q.counts.activeListings, format: "count" },
    { key: "practitioners", label: "Practitioners", value: q.counts.practitioners, format: "count" },
    { key: "hosts", label: "Hosts", value: q.counts.hosts, format: "count" },
    { key: "hosts_unpaid", label: "Hosts awaiting payout", value: q.counts.hostsUnpaid, format: "count" },
    // Not derivable from the DB alone — needs the analytics stream, which is new.
    { key: "visitors_today", label: "Website visitors · today", value: null, format: "count" },
    { key: "app_opens_today", label: "App opens · today", value: null, format: "count" },
  ];

  return {
    urgentCount,
    kpis,
    health: deriveHealth(q),
    needsAttention,
    queuesTotal: candidates.length,
    queuesClear: needsAttention.length === 0,
    liveSessions: q.liveSessions,
    activity: q.activity.slice(0, 40),
  };
}
