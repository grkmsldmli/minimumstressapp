/**
 * Environment access for Supabase, checked once and loudly.
 *
 * A missing URL or key otherwise surfaces as an opaque fetch failure deep in a
 * query, so these throw at the point of use with a message that says which
 * variable is missing and where to put it.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and fill it in — see the Supabase dashboard under Settings → Data API.`,
    );
  }
  return value;
}

export function supabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function supabasePublishableKey(): string {
  return required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

/**
 * Bypasses RLS. Server-only.
 *
 * The guard below is not decoration: reading this from a client component
 * would bundle the key into JavaScript served to every visitor, handing anyone
 * who opened devtools unrestricted access to every table. Failing loudly at
 * build time is the cheap version of that mistake.
 */
export function supabaseSecretKey(): string {
  if (typeof window !== "undefined") {
    throw new Error("SUPABASE_SECRET_KEY was read in the browser. It is server-only.");
  }
  return required("SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY);
}

/** True when there is enough configuration to talk to a real project. */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
