/**
 * What is waiting on a person, and whether it is worth interrupting them for.
 *
 * The operator screen shows all of this already and shows it well. What it
 * cannot do is reach anybody: it is a page, and a page has to be opened. Two
 * events send mail today — a safety report and an account change request — and
 * everything else waits until somebody happens to look.
 *
 * That is fine while the operator is the only user and checks hourly. It stops
 * being fine the moment a host is standing in a studio they opened for a
 * session we cannot pay them for, and the first anybody hears of it is the
 * next time the page is loaded.
 *
 * So: the same queue, asked one question. Is anything waiting on a human, and
 * has that set changed since we last said so.
 *
 * Pure, because the decision about what deserves an interruption is a rule
 * rather than plumbing, and rules in this codebase are tested without a
 * database. The cron does the fetching and the sending.
 */

/** Ordered worst first, which is also the order they are listed in the email. */
export type WaitingKind =
  | "unpayable_host"
  | "open_dispute"
  | "escalation"
  | "pending_listing"
  | "account_change"
  | "failed_notification";

export interface WaitingItem {
  kind: WaitingKind;
  /** How many are in this state. Never zero — an empty group is left out. */
  count: number;
  /** One line, written for somebody reading it on a phone at the weekend. */
  line: string;
}

export interface QueueCounts {
  unpayableHosts: number;
  openDisputes: number;
  escalations: number;
  pendingListings: number;
  accountChangeRequests: number;
  failedNotifications: number;
}

/**
 * Worst first, and the order is an argument rather than a preference.
 *
 * A host who cannot be paid has already done their part — the room was opened,
 * the session happened, and the money is sitting with us. Nothing else on this
 * list has somebody out of pocket while they wait.
 *
 * A safety escalation outranks a listing review for the obvious reason, and a
 * failed notification is last because it is the only one where the person
 * affected does not know they are waiting.
 */
const ORDER: WaitingKind[] = [
  "unpayable_host",
  "escalation",
  "open_dispute",
  "account_change",
  "pending_listing",
  "failed_notification",
];

const LINES: Record<WaitingKind, (n: number) => string> = {
  unpayable_host: (n) =>
    n === 1
      ? "1 host cannot be paid — their money is sitting with us"
      : `${n} hosts cannot be paid — their money is sitting with us`,
  escalation: (n) => (n === 1 ? "1 safety report to read" : `${n} safety reports to read`),
  open_dispute: (n) =>
    n === 1 ? "1 money dispute waiting on a decision" : `${n} money disputes waiting on a decision`,
  account_change: (n) =>
    n === 1 ? "1 account change request" : `${n} account change requests`,
  pending_listing: (n) =>
    n === 1 ? "1 listing waiting for review" : `${n} listings waiting for review`,
  failed_notification: (n) =>
    n === 1
      ? "1 notification we could not deliver"
      : `${n} notifications we could not deliver`,
};

const COUNT_OF: Record<WaitingKind, (q: QueueCounts) => number> = {
  unpayable_host: (q) => q.unpayableHosts,
  escalation: (q) => q.escalations,
  open_dispute: (q) => q.openDisputes,
  account_change: (q) => q.accountChangeRequests,
  pending_listing: (q) => q.pendingListings,
  failed_notification: (q) => q.failedNotifications,
};

export function waitingOn(counts: QueueCounts): WaitingItem[] {
  return ORDER.map((kind) => ({ kind, count: COUNT_OF[kind](counts) }))
    .filter((item) => item.count > 0)
    .map((item) => ({ ...item, line: LINES[item.kind](item.count) }));
}

/**
 * What to say in the subject line, which is all most people read.
 *
 * The worst thing first and the rest as a number, because a subject reading
 * "6 things need you" says nothing about whether to open it now or after
 * dinner.
 */
export function subjectFor(items: WaitingItem[]): string {
  if (items.length === 0) return "";

  const [first, ...rest] = items;
  const others = rest.reduce((sum, item) => sum + item.count, 0);
  const head = first.line.replace(/ — .*$/, "");

  return others === 0 ? head : `${head}, and ${others} more waiting`;
}

/**
 * A fingerprint of what is waiting, so the same news is not sent twice.
 *
 * Dedupe on this and the day: a set that has not changed produces the same key
 * and the second send is dropped, while anything new — a dispute filed, a
 * listing submitted — changes the key and gets through immediately. The date
 * keeps a long-standing queue from going quiet forever, so an item nobody has
 * dealt with is raised again tomorrow rather than once and never.
 */
export function waitingSignature(items: WaitingItem[], today: Date): string {
  const shape = items.map((item) => `${item.kind}=${item.count}`).join(",");
  return `${today.toISOString().slice(0, 10)}:${shape}`;
}
