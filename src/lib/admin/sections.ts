import { deriveHealth, type HealthItem } from "./command";
import type { AdminQueue, DayCount, DayMoney, FailedNotification, UnpayableHost } from "./queue";

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
  bookingsByDay: DayCount[];
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
    bookingsByDay: q.bookingsByDay,
    unpayableHosts: q.unpayableHosts,
    hostsUnpaid: q.counts.hostsUnpaid,
  };
}

export interface SystemView {
  health: HealthItem[];
  counts: AdminQueue["counts"];
  termsOutstanding: number;
  failedNotifications: FailedNotification[];
}

export function systemView(q: AdminQueue): SystemView {
  return {
    health: deriveHealth(q),
    counts: q.counts,
    termsOutstanding: q.termsOutstanding,
    failedNotifications: q.failedNotifications,
  };
}
