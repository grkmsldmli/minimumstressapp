/**
 * Whatever was thrown, turned into a sentence a person can read.
 *
 * Nine screens were each doing `cause instanceof Error ? cause.message : "..."`,
 * which sounds careful and throws away almost everything. Supabase does not
 * throw Errors: a PostgrestError is a plain object of `{ message, details,
 * hint, code }`, and a StorageError is another shape again. So `instanceof`
 * was false every time it mattered, and every database refusal reached the
 * screen as the generic fallback.
 *
 * That is worse than it sounds, because the messages being discarded are the
 * ones written for exactly this moment — "This space has 2 upcoming sessions.
 * Its address and room type cannot change until those are done", raised by a
 * trigger and then replaced with "That did not save."
 *
 * One place did `String(cause)`, which renders a plain object as
 * "[object Object]". That was on screen.
 */

/** Fields carrying a human message across the shapes we actually throw. */
const FIELDS = ["message", "error_description", "error", "msg", "hint"] as const;

export function errorMessage(cause: unknown, fallback: string): string {
  const found = extract(cause);
  if (!found) return fallback;

  /*
   * Postgres prefixes raised exceptions with its own context and appends the
   * function that raised them. The sentence in the middle is the one written
   * for a person; the rest is for a log.
   */
  const cleaned = found
    .replace(/^ERROR:\s*/i, "")
    .replace(/\s*CONTEXT:[\s\S]*$/i, "")
    .trim();

  if (!cleaned) return fallback;

  // Anything that still reads as machinery is not worth showing. A person
  // cannot act on a constraint name.
  if (/^[a-z0-9_]+$/.test(cleaned) || cleaned.length < 4) return fallback;

  return cleaned;
}

function extract(cause: unknown): string | null {
  if (typeof cause === "string") return cause;
  if (cause instanceof Error) return cause.message;

  if (cause && typeof cause === "object") {
    const record = cause as Record<string, unknown>;
    for (const field of FIELDS) {
      const value = record[field];
      if (typeof value === "string" && value.trim()) return value;
    }
  }

  return null;
}
