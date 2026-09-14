/**
 * The Command home, projected from the audited admin queue.
 *
 * Pure so it is testable and cannot drift: it takes the AdminQueue and shapes
 * the founder's first screen — KPIs, health, ranked attention, and live/activity
 * slices. Nothing here invents a number: a metric we do not yet track is absent
 * (null), never shown as a reassuring zero.
 */

import type { ActivityEntry, AdminQueue, LiveSession } from "./queue";

export interface Kpi {
  key: string;
  label: string;
  /** null means unavailable/unmeasured — never conflated with a real 0. */
  value: number | null;
  format: "money" | "count";
  strong?: boolean;
  sub?: string;
  nullLabel?: string;
}

export interface HealthItem {
  key: string;
  label: string;
  state: "healthy" | "attention" | "critical" | "unknown";
  note?: string;
  /** When this particular piece of evidence was observed. */
  checkedAt?: string;
  /** Probe duration, useful for distinguishing reachable from merely configured. */
  latencyMs?: number;
  /** Provider event freshness where an actual receipt is the evidence. */
  lastSeenAt?: string | null;
}

export interface CommandRuntimeEvidence {
  /** Independent, live probes for DB/Auth/Stripe/analytics. */
  coreHealth?: HealthItem[];
  /** Completion time of the broad business/reporting read. */
  reportingCheckedAt?: string;
  /** Configuration is injected so this projection stays pure and testable. */
  notificationsConfigured?: boolean;
  analytics?: {
    available: boolean;
    websiteSessionsToday: number | null;
    appOpensToday: number | null;
    truncated: boolean;
  };
}

export interface AttentionItem {
  key: string;
  label: string;
  count: number;
  href: string;
  tone: "bad" | "warn";
}

export interface CommandView {
  /** False means the business/reporting read failed; no empty arrays are facts. */
  reportingAvailable: boolean;
  urgentCount: number | null;
  kpis: Kpi[];
  health: HealthItem[];
  needsAttention: AttentionItem[];
  queuesTotal: number | null;
  queuesClear: boolean | null;
  liveSessions: LiveSession[];
  activity: ActivityEntry[];
}

/**
 * System health, only where it can actually be measured.
 *
 * Live infrastructure evidence is injected by the staff-gated route. Missing
 * evidence is unknown, never green. Notification delivery is combined here
 * because its strongest evidence is the same fresh outbox read that builds the
 * operator queue; Stripe Connect also incorporates hosts currently blocked
 * from receiving money.
 */
export function deriveHealth(
  q: AdminQueue | null,
  evidence: CommandRuntimeEvidence = {},
): HealthItem[] {
  const byKey = new Map((evidence.coreHealth ?? []).map((item) => [item.key, item]));
  const unknown = (key: string, label: string): HealthItem =>
    byKey.get(key) ?? { key, label, state: "unknown", note: "Not checked" };

  const reporting: HealthItem = q
    ? {
        key: "reporting_data",
        label: "Reporting data",
        state: "healthy",
        note: "Operational queries succeeded",
        checkedAt: evidence.reportingCheckedAt,
      }
    : {
        key: "reporting_data",
        label: "Reporting data",
        state: "critical",
        note: "Operational queries unavailable",
        checkedAt: evidence.reportingCheckedAt,
      };

  const failedGivenUp = q?.failedNotifications.filter((item) => item.givenUp).length;
  const retrying = q ? q.failedNotifications.length - (failedGivenUp ?? 0) : null;
  const checkedAt = evidence.reportingCheckedAt;
  const notifications: HealthItem = q === null
    ? {
        key: "notifications",
        label: "Email notifications",
        state: "unknown",
        note: evidence.notificationsConfigured
          ? "Configured · delivery queue unavailable"
          : "Not configured · delivery queue unavailable",
        checkedAt,
      }
    : (failedGivenUp ?? 0) > 0
    ? {
        key: "notifications",
        label: "Email notifications",
        state: "attention",
        note: `${failedGivenUp} permanently failed`,
        checkedAt,
      }
    : (retrying ?? 0) > 0
      ? {
          key: "notifications",
          label: "Email notifications",
          state: "attention",
          note: `${retrying} retrying`,
          checkedAt,
        }
      : evidence.notificationsConfigured
        ? {
            key: "notifications",
            label: "Email notifications",
            state: "unknown",
            note: "Configured · delivery unverified",
            checkedAt,
          }
        : {
            key: "notifications",
            label: "Email notifications",
            state: "unknown",
            note: "Not configured",
            checkedAt,
          };

  let payouts = unknown("stripe_payouts", "Stripe Connect payouts");
  if (q && q.unpayableHosts.length > 0 && payouts.state !== "critical") {
    payouts = {
      ...payouts,
      state: "attention",
      note: `${q.unpayableHosts.length} ${q.unpayableHosts.length === 1 ? "host" : "hosts"} cannot receive payouts`,
    };
  }

  return [
    unknown("database", "Database"),
    unknown("auth", "Auth"),
    reporting,
    notifications,
    unknown("stripe_payments", "Stripe payments"),
    payouts,
    unknown("web_analytics", "Web analytics"),
  ];
}

export function commandView(
  q: AdminQueue | null,
  evidence: CommandRuntimeEvidence = {},
): CommandView {
  const reportingAvailable = q !== null;
  const disputesOnUs = q?.openDisputes.filter((d) => d.waitingOn === "us").length ?? 0;
  const failedGivenUp = q?.failedNotifications.filter((n) => n.givenUp).length ?? 0;

  // Ranked by who is hurt while nobody looks: safety, then money, then the rest.
  const candidates: AttentionItem[] = q ? [
    { key: "safety", label: "Safety & low ratings", count: q.escalations.length, href: "/admin/trust", tone: "bad" },
    { key: "disputes", label: "Refunds & claims waiting on us", count: disputesOnUs, href: "/admin/trust", tone: "bad" },
    { key: "unpayable", label: "Hosts who cannot be paid", count: q.unpayableHosts.length, href: "/admin/trust", tone: "warn" },
    { key: "failed", label: "Messages that failed for good", count: failedGivenUp, href: "/admin/trust", tone: "bad" },
    { key: "insurance", label: "Insurance waiting for review", count: q.pendingInsurance.length, href: "/admin/trust", tone: "warn" },
    { key: "space_insurance", label: "Space insurance waiting for review", count: q.pendingSpaceInsurance.length, href: "/admin/trust", tone: "warn" },
    { key: "credentials", label: "Credentials waiting for review", count: q.pendingCredentials.length, href: "/admin/trust", tone: "warn" },
    { key: "listing_closures", label: "Permanent listing closures", count: q.listingClosureRequests.length, href: "/admin/spaces", tone: "warn" },
    { key: "listings", label: "Listings waiting for review", count: q.pendingListings.length, href: "/admin/trust", tone: "warn" },
    { key: "account_changes", label: "Account change requests", count: q.accountChangeRequests.length, href: "/admin/trust", tone: "warn" },
    { key: "at_risk", label: "Accounts at risk", count: q.atRisk.length, href: "/admin/trust", tone: "warn" },
  ] : [];
  const needsAttention = candidates.filter((c) => c.count > 0);

  // Urgent = the safety/money slice worth a badge, not the whole backlog.
  const urgentCount = q
    ? q.escalations.length + disputesOnUs + q.unpayableHosts.length + failedGivenUp
    : null;

  const kpis: Kpi[] = [
    { key: "platform_month", label: "Our net revenue · this month", value: q?.money.platformCents ?? null, format: "money", strong: true, nullLabel: "Unavailable" },
    { key: "gmv_month", label: "Net booking volume · this month", value: q?.money.grossCents ?? null, format: "money", sub: "practitioner payments after refunds", nullLabel: "Unavailable" },
    { key: "host_month", label: "Host earnings · this month", value: q?.money.hostCents ?? null, format: "money", sub: "earned — not necessarily paid out yet", nullLabel: "Unavailable" },
    { key: "platform_all", label: "Our net revenue · all time", value: q?.money.platformAllTimeCents ?? null, format: "money", nullLabel: "Unavailable" },
    { key: "sessions_month", label: "Bookings · this month", value: q?.counts.sessionsThisMonth ?? null, format: "count", sub: "captured bookings", nullLabel: "Unavailable" },
    { key: "upcoming", label: "Upcoming bookings", value: q?.counts.upcomingSessions ?? null, format: "count", nullLabel: "Unavailable" },
    { key: "live_listings", label: "Live listings", value: q?.counts.activeListings ?? null, format: "count", nullLabel: "Unavailable" },
    { key: "practitioners", label: "Practitioners", value: q?.counts.practitioners ?? null, format: "count", nullLabel: "Unavailable" },
    { key: "hosts", label: "Hosts", value: q?.counts.hosts ?? null, format: "count", nullLabel: "Unavailable" },
    { key: "hosts_unpaid", label: "Unpaid host sessions", value: q?.counts.hostsUnpaid ?? null, format: "count", sub: "completed/due, payout not recorded", nullLabel: "Unavailable" },
    {
      key: "visitors_today",
      label: "Website sessions · today",
      value: evidence.analytics?.available
        ? evidence.analytics.websiteSessionsToday
        : null,
      format: "count",
      nullLabel: "Unavailable",
      sub: evidence.analytics?.truncated ? "At least this many · daily read cap reached" : undefined,
    },
    {
      key: "app_opens_today",
      label: "App opens · today",
      value: evidence.analytics?.available ? evidence.analytics.appOpensToday : null,
      format: "count",
      nullLabel: "Unavailable",
    },
  ];

  return {
    reportingAvailable,
    urgentCount,
    kpis,
    health: deriveHealth(q, evidence),
    needsAttention,
    queuesTotal: q ? candidates.length : null,
    queuesClear: q ? needsAttention.length === 0 : null,
    liveSessions: q?.liveSessions ?? [],
    activity: q?.activity.slice(0, 40) ?? [],
  };
}
