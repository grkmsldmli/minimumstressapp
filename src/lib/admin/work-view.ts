import type { DirPerson } from "./directory";

/**
 * Work (the coverage board), told from real rows.
 *
 * A lighter section than the marketplace core, but not a stub: it counts the
 * request board by state and lists what is open and unfilled — the requests a
 * host has posted that nobody has covered yet, which are the ones that decide
 * whether the board feels alive.
 */

export interface RawWorkRequest {
  id: string;
  host_id: string | null;
  title: string;
  profession: string | null;
  starts_at: string;
  ends_at: string | null;
  pay_cents: number | null;
  urgent: boolean | null;
  state: string;
  created_at: string | null;
  filled_at: string | null;
}

export interface RawWorkInterest {
  request_id: string;
  state: string;
}

export interface OpenWorkRequest {
  id: string;
  title: string;
  profession: string | null;
  startsAt: string;
  payCents: number;
  urgent: boolean;
  hostId: string | null;
  hostName: string | null;
  interested: number;
}

export interface WorkView {
  counts: {
    total: number;
    open: number;
    filled: number;
    completed: number;
    cancelled: number;
    expired: number;
    urgentOpen: number;
  };
  interest: { total: number; confirmed: number };
  openRequests: OpenWorkRequest[];
}

export function workView(
  requests: RawWorkRequest[],
  interest: RawWorkInterest[],
  people: DirPerson[],
): WorkView {
  const nameById = new Map(people.map((p) => [p.id, p.displayName ?? p.email]));

  const interestByRequest = new Map<string, number>();
  let confirmed = 0;
  for (const row of interest) {
    if (row.state === "confirmed") confirmed += 1;
    if (row.state === "interested" || row.state === "confirmed") {
      interestByRequest.set(row.request_id, (interestByRequest.get(row.request_id) ?? 0) + 1);
    }
  }

  const counts = {
    total: requests.length,
    open: requests.filter((r) => r.state === "open").length,
    filled: requests.filter((r) => r.state === "filled").length,
    completed: requests.filter((r) => r.state === "completed").length,
    cancelled: requests.filter((r) => r.state === "cancelled").length,
    expired: requests.filter((r) => r.state === "expired").length,
    urgentOpen: requests.filter((r) => r.state === "open" && r.urgent).length,
  };

  const openRequests: OpenWorkRequest[] = requests
    .filter((r) => r.state === "open")
    .map((r) => ({
      id: r.id,
      title: r.title,
      profession: r.profession,
      startsAt: r.starts_at,
      payCents: r.pay_cents ?? 0,
      urgent: Boolean(r.urgent),
      hostId: r.host_id,
      hostName: r.host_id ? nameById.get(r.host_id) ?? null : null,
      interested: interestByRequest.get(r.id) ?? 0,
    }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return { counts, interest: { total: interest.length, confirmed }, openRequests };
}
