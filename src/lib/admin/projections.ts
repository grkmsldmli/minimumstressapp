import type { DirBooking, DirPerson, DirSpace, Directory } from "./directory";

/**
 * A person as a directory/search row — everything the tables and result lists
 * render, but WITHOUT the emergency contact. That field is genuinely sensitive
 * and is only ever shown on the person detail page, so it is never transmitted
 * in a list of 25+ people; the detail route carries the full DirPerson.
 */
export type PersonListItem = Omit<DirPerson, "emergency">;

export function toListPerson({ emergency: _emergency, ...rest }: DirPerson): PersonListItem {
  return rest;
}

/**
 * The status an operator thinks in. The `space_status` enum has no "archived"
 * value — an archived listing is `delisted` with `archived_at` set (migration
 * 0053) — so "archived" is derived here, and a plain "delisted" is one that was
 * paused but never archived. Filtering and the status pill both go through this
 * so the two never disagree.
 */
export function effectiveSpaceStatus(s: { status: string; archivedAt: string | null }): string {
  return s.archivedAt ? "archived" : s.status;
}

/**
 * Pure views over the directory: search, filter, paginate, and the three detail
 * selectors. Kept separate from the read so they can be tested directly, and so
 * every section route shapes the same graph the same way.
 *
 * These never touch message contents, access codes or documents — a directory is
 * who and what and how much, never what was said. The privacy the masking
 * guarantees from the inside is not undone here from the outside.
 */

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

const DEFAULT_PAGE_SIZE = 25;

export function paginate<T>(list: T[], page = 1, pageSize = DEFAULT_PAGE_SIZE): Page<T> {
  const size = Math.max(1, Math.min(pageSize, 100));
  const pages = Math.max(1, Math.ceil(list.length / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (current - 1) * size;
  return {
    items: list.slice(start, start + size),
    total: list.length,
    page: current,
    pageSize: size,
    pages,
  };
}

const has = (haystack: string | null | undefined, needle: string) =>
  (haystack ?? "").toLowerCase().includes(needle);

export function filterPeople(
  people: DirPerson[],
  opts: { q?: string; type?: string } = {},
): DirPerson[] {
  const term = (opts.q ?? "").trim().toLowerCase();
  return people.filter((p) => {
    if (opts.type && opts.type !== "all" && p.accountType !== opts.type) return false;
    if (!term) return true;
    return has(p.email, term) || has(p.displayName, term) || has(p.id, term);
  });
}

export function filterSpaces(
  spaces: DirSpace[],
  opts: { q?: string; status?: string } = {},
): DirSpace[] {
  const term = (opts.q ?? "").trim().toLowerCase();
  return spaces.filter((s) => {
    if (opts.status && opts.status !== "all" && effectiveSpaceStatus(s) !== opts.status) return false;
    if (!term) return true;
    return (
      has(s.name, term) ||
      has(s.addressLine, term) ||
      has(s.hostEmail, term) ||
      has(s.hostName, term) ||
      has(s.id, term)
    );
  });
}

export function filterBookings(
  bookings: DirBooking[],
  opts: { q?: string; status?: string } = {},
): DirBooking[] {
  const term = (opts.q ?? "").trim().toLowerCase();
  return bookings.filter((b) => {
    if (opts.status && opts.status !== "all" && b.status !== opts.status) return false;
    if (!term) return true;
    return (
      has(b.spaceName, term) ||
      has(b.practitionerName, term) ||
      has(b.practitionerEmail, term) ||
      has(b.hostName, term) ||
      has(b.hostEmail, term) ||
      has(b.id, term)
    );
  });
}

export interface SearchResults {
  term: string;
  people: PersonListItem[];
  spaces: DirSpace[];
  bookings: DirBooking[];
  totalPeople: number;
  totalSpaces: number;
  totalBookings: number;
}

/** One box, three kinds of result — the way an operator actually looks. */
export function searchDirectory(dir: Directory, term: string, limit = 8): SearchResults {
  const trimmed = term.trim();
  if (trimmed.length < 2) {
    return {
      term: trimmed,
      people: [],
      spaces: [],
      bookings: [],
      totalPeople: 0,
      totalSpaces: 0,
      totalBookings: 0,
    };
  }
  const people = filterPeople(dir.people, { q: trimmed });
  const spaces = filterSpaces(dir.spaces, { q: trimmed });
  const bookings = filterBookings(dir.bookings, { q: trimmed });
  return {
    term: trimmed,
    people: people.slice(0, limit).map(toListPerson),
    spaces: spaces.slice(0, limit),
    bookings: bookings.slice(0, limit),
    totalPeople: people.length,
    totalSpaces: spaces.length,
    totalBookings: bookings.length,
  };
}

export interface PersonDetail {
  person: DirPerson;
  /** Their rooms (hosts). Empty for a practitioner. */
  listings: DirSpace[];
  /** Sessions they booked to run. */
  asPractitioner: DirBooking[];
  /** Sessions run in their rooms. */
  asHost: DirBooking[];
}

export function personDetail(dir: Directory, id: string): PersonDetail | null {
  const person = dir.people.find((p) => p.id === id);
  if (!person) return null;
  return {
    person,
    listings: dir.spaces.filter((s) => s.hostId === id),
    asPractitioner: dir.bookings.filter((b) => b.practitionerId === id),
    asHost: dir.bookings.filter((b) => b.hostId === id),
  };
}

export interface SpaceDetail {
  space: DirSpace;
  bookings: DirBooking[];
}

export function spaceDetail(dir: Directory, id: string): SpaceDetail | null {
  const space = dir.spaces.find((s) => s.id === id);
  if (!space) return null;
  return { space, bookings: dir.bookings.filter((b) => b.spaceId === id) };
}

export function bookingDetail(dir: Directory, id: string): DirBooking | null {
  return dir.bookings.find((b) => b.id === id) ?? null;
}
