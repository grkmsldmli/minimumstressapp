/**
 * Reading a request body without trusting it.
 *
 * Each route was doing this by hand, and by hand meant slightly differently
 * each time: one checked a string was non-empty, another did not; one bounded
 * a length, another let an unbounded comment through to a text column. None of
 * those was a hole on its own. Together they are the surface where the next
 * one appears.
 *
 * Deliberately small — no schema library, no inference. Six functions, each of
 * which answers one question and returns a reason rather than throwing, so a
 * route can say what was wrong instead of returning "invalid request".
 */

export type Validated<T> = { ok: true; value: T } | { ok: false; reason: string };

const ok = <T,>(value: T): Validated<T> => ({ ok: true, value });
const bad = (reason: string): Validated<never> => ({ ok: false, reason });

/**
 * Parses JSON and refuses anything that is not a plain object.
 *
 * An array is valid JSON and would sail past a `typeof === "object"` check
 * while every field read off it comes back undefined — which then reads as
 * "field missing" rather than "you sent the wrong shape".
 */
export async function jsonObject(request: Request): Promise<Validated<Record<string, unknown>>> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return bad("Expected a JSON body");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return bad("Expected a JSON object");
  }

  return ok(parsed as Record<string, unknown>);
}

export function requiredString(
  body: Record<string, unknown>,
  field: string,
  { max = 500 }: { max?: number } = {},
): Validated<string> {
  const value = body[field];
  if (typeof value !== "string") return bad(`${field} is required`);

  const trimmed = value.trim();
  if (trimmed === "") return bad(`${field} is required`);
  if (trimmed.length > max) return bad(`${field} is too long`);

  return ok(trimmed);
}

export function optionalString(
  body: Record<string, unknown>,
  field: string,
  { max = 5000 }: { max?: number } = {},
): Validated<string> {
  const value = body[field];
  if (value === undefined || value === null) return ok("");
  if (typeof value !== "string") return bad(`${field} must be text`);
  if (value.length > max) return bad(`${field} is too long`);
  return ok(value.trim());
}

/**
 * An identifier, in the shape the database actually uses.
 *
 * Every id in this schema is a uuid. Accepting any non-empty string means a
 * malformed one reaches Postgres and comes back as a type error — which is
 * safe, but surfaces as a 500 on a request that was simply wrong.
 */
export function uuid(body: Record<string, unknown>, field: string): Validated<string> {
  const value = body[field];
  if (typeof value !== "string") return bad(`${field} is required`);

  const trimmed = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return bad(`${field} is not a valid id`);
  }

  return ok(trimmed);
}

/** An ISO timestamp, returned as the Date it parses to. */
export function timestamp(body: Record<string, unknown>, field: string): Validated<Date> {
  const value = body[field];
  if (typeof value !== "string") return bad(`${field} is required, as an ISO timestamp`);

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return bad(`${field} is not a valid timestamp`);

  return ok(date);
}

/**
 * An integer inside a range.
 *
 * Rejects a non-integer rather than rounding it. A caller sending 3.5 stars
 * meant something, and quietly deciding whether that is three or four is how a
 * rating nobody gave ends up in a table.
 */
export function integer(
  body: Record<string, unknown>,
  field: string,
  { min, max }: { min: number; max: number },
): Validated<number> {
  const value = body[field];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return bad(`${field} must be a whole number`);
  }
  if (value < min || value > max) return bad(`${field} must be between ${min} and ${max}`);
  return ok(value);
}

/** One of a fixed set. The set is the validation. */
export function oneOf<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
  fallback?: T,
): Validated<T> {
  const value = body[field];
  if (value === undefined && fallback !== undefined) return ok(fallback);
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    return bad(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return ok(value as T);
}

/**
 * A boolean, where anything that is not exactly `true` is false.
 *
 * Not a coercion — "false", 0 and null all mean false here because the only
 * thing this is used for is a flag someone did or did not tick, and treating
 * an unexpected value as "ticked" is the wrong way to be wrong.
 */
export function flag(body: Record<string, unknown>, field: string): boolean {
  return body[field] === true;
}
