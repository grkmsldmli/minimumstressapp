import {
  deriveHealth,
  type CommandRuntimeEvidence,
  type HealthItem,
} from "./command";
import type { AdminQueue, DayMoney, FailedNotification, UnpayableHost } from "./queue";

/**
 * The Money and System section projections, pure over the one queue read.
 *
 * Money keeps the three figures that must never be confused: booking volume
 * (what practitioners paid), host earnings (theirs), and platform revenue
 * (ours). Summing any two of them double-counts a session, so they are carried
 * and shown as three distinct numbers, never a total.
 */

export interface MoneyView {
  month: { platformCents: number; hostCents: number; grossCents: number };
  allTime: { platformCents: number };
  byDay: DayMoney[];
  unpayableHosts: UnpayableHost[];
  hostsUnpaid: number;
}

export function moneyView(q: AdminQueue): MoneyView {
  return {
    month: {
      platformCents: q.money.platformCents,
      hostCents: q.money.hostCents,
      grossCents: q.money.grossCents,
    },
    allTime: { platformCents: q.money.platformAllTimeCents },
    byDay: q.moneyByDay,
    unpayableHosts: q.unpayableHosts,
    hostsUnpaid: q.counts.hostsUnpaid,
  };
}

export interface SystemView {
  reportingAvailable: boolean;
  health: HealthItem[];
  counts: AdminQueue["counts"] | null;
  termsOutstanding: number | null;
  failedNotifications: FailedNotification[] | null;
}

export function systemView(
  q: AdminQueue | null,
  evidence: CommandRuntimeEvidence = {},
): SystemView {
  return {
    reportingAvailable: q !== null,
    health: deriveHealth(q, evidence),
    counts: q?.counts ?? null,
    termsOutstanding: q?.termsOutstanding ?? null,
    failedNotifications: q?.failedNotifications ?? null,
  };
}
