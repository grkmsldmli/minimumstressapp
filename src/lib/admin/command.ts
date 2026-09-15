/**
 * The Command home, projected from the audited admin queue.
 *
 * Pure so it is testable and cannot drift: it takes the AdminQueue and shapes
 * the founder's first screen — KPIs, health, ranked attention, and live/activity
 * slices. Nothing here invents a number: a metric we do not yet track is absent
 * (null), never shown as a reassuring zero.
 */

import type { ResendDeliveryEventType } from "@/lib/resend/webhook";

import type { EmailDeliveryEvidence } from "./email-delivery";
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
  /** A configured sender is not observable until its signed webhook exists. */
  emailWebhookConfigured?: boolean;
  /** Latest provider-authenticated delivery outcome, never API acceptance. */
  emailDelivery?: EmailDeliveryEvidence;
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
  const delivery = deliveryHealth(evidence);
  let notifications: HealthItem = (failedGivenUp ?? 0) > 0
    ? {
        key: "notifications",
        label: "Email notifications",
        state: "attention",
        note: `${failedGivenUp} permanently failed`,
        checkedAt: evidence.reportingCheckedAt,
      }
    : (retrying ?? 0) > 0
      ? {
          key: "notifications",
          label: "Email notifications",
          state: "attention",
          note: `${retrying} retrying`,
          checkedAt: evidence.reportingCheckedAt,
        }
      : delivery;

  // A provider failure is still actionable if the broad reporting read is
  // down. Positive provider evidence alone cannot be green while the outbox
  // itself is unreadable, because unsent work could be hiding there.
  if (q === null && notifications.state !== "attention") {
    notifications = {
      ...notifications,
      state: "unknown",
      note: `${notifications.note ?? "Delivery status unknown"} · queue unavailable`,
    };
  }

  let payouts = unknown("stripe_payouts", "Stripe Connect payouts");
  if (q && q.unpayableHosts.length > 0 && payouts.state !== "critical") {
    payouts = {
      ...payouts,
      state: "attention",
      note: `${q.unpayableHosts.length} ${q.unpayableHosts.length === 1 ? "host" : "hosts"} cannot receive payouts`,
    };
  }

  let payments = unknown("stripe_payments", "Stripe payments");
  if (q && q.financialManualReview.length > 0 && payments.state !== "critical") {
    payments = {
      ...payments,
      state: "critical",
      note: `${q.financialManualReview.length} booking ${q.financialManualReview.length === 1 ? "payment needs" : "payments need"} manual review`,
    };
  }

  return [
    unknown("database", "Database"),
    unknown("auth", "Auth"),
    reporting,
    notifications,
    payments,
    payouts,
    unknown("web_analytics", "Web analytics"),
  ];
}

const EMAIL_DELIVERY_FRESHNESS_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_DELIVERY_CLOCK_SKEW_MS = 5 * 60 * 1000;

function deliveryHealth(evidence: CommandRuntimeEvidence): HealthItem {
  const base = { key: "notifications", label: "Email notifications" } as const;
  if (!evidence.notificationsConfigured) {
    return { ...base, state: "unknown", note: "Not configured" };
  }
  if (!evidence.emailWebhookConfigured) {
    return {
      ...base,
      state: "unknown",
      note: "Sending configured · webhook not configured",
    };
  }

  const delivery = evidence.emailDelivery;
  if (!delivery?.available) {
    return {
      ...base,
      state: "unknown",
      note: "Configured · delivery evidence unavailable",
      checkedAt: delivery?.checkedAt,
    };
  }
  if (!delivery.lastEventAt || !delivery.lastEventType) {
    return {
      ...base,
      state: "unknown",
      note: "Configured · waiting for delivery test",
      checkedAt: delivery.checkedAt,
    };
  }

  const eventAt = Date.parse(delivery.lastEventAt);
  const checkedAt = Date.parse(delivery.checkedAt);
  if (
    Number.isNaN(eventAt) ||
    Number.isNaN(checkedAt) ||
    eventAt - checkedAt > EMAIL_DELIVERY_CLOCK_SKEW_MS
  ) {
    return {
      ...base,
      state: "unknown",
      note: "Delivery evidence timestamp invalid",
      checkedAt: delivery.checkedAt,
    };
  }

  if (checkedAt - eventAt > EMAIL_DELIVERY_FRESHNESS_MS) {
    return {
      ...base,
      state: "unknown",
      note: "No delivery event in 30 days",
      checkedAt: delivery.checkedAt,
      lastSeenAt: delivery.lastEventAt,
    };
  }

  if (delivery.lastEventType === "email.delivered") {
    return {
      ...base,
      state: "healthy",
      note: "Delivery verified",
      checkedAt: delivery.checkedAt,
      lastSeenAt: delivery.lastEventAt,
    };
  }

  const failureNote: Record<Exclude<ResendDeliveryEventType, "email.delivered">, string> = {
    "email.delivery_delayed": "Latest email delivery is delayed",
    "email.failed": "Latest email failed",
    "email.bounced": "Latest email bounced",
    "email.complained": "Latest email marked as spam",
    "email.suppressed": "Latest email was suppressed",
  };
  return {
    ...base,
    state: "attention",
    note: failureNote[delivery.lastEventType],
    checkedAt: delivery.checkedAt,
    lastSeenAt: delivery.lastEventAt,
  };
}

export function commandView(
  q: AdminQueue | null,
  evidence: CommandRuntimeEvidence = {},
): CommandView {
  const reportingAvailable = q !== null;
  const disputesOnUs = q?.openDisputes.filter((d) => d.waitingOn === "us").length ?? 0;
  const failedGivenUp = q?.failedNotifications.filter((n) => n.givenUp).length ?? 0;
  const financialManualReview = q?.financialManualReview.length ?? 0;

  // Ranked by who is hurt while nobody looks: safety, then money, then the rest.
  const candidates: AttentionItem[] = q ? [
    { key: "financial", label: "Booking payments needing manual review", count: financialManualReview, href: "/admin/money", tone: "bad" },
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
    ? financialManualReview + q.escalations.length + disputesOnUs + q.unpayableHosts.length + failedGivenUp
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
