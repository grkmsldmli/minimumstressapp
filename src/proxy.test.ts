import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Imported after the environment is set, not before.
 *
 * The origins are read once when the module loads, so a static import here
 * would capture an empty string and every assertion about the storage bucket
 * would pass against a policy that names nothing — testing that the test can
 * be fooled. Which is also worth knowing: with the variable unset the app
 * ships a policy that silently blocks its own images.
 */
let proxy: (request: NextRequest) => { headers: Headers };

const SUPABASE = "https://abcdefgh.supabase.co";

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE;
  ({ proxy } = (await import("./proxy")) as unknown as { proxy: typeof proxy });
});

/**
 * The content security policy, checked by directive.
 *
 * These fail quietly, which is the whole problem with them: a blocked video
 * looks identical to one that has not finished loading, and a blocked image
 * looks like a slow network. Nothing in the app can tell the difference, so
 * the only place to notice is here.
 *
 * `media-src` was missing entirely. A host could upload a room tour, and the
 * browser would refuse to play it back from the bucket it had just been
 * stored in — falling through to `default-src 'self'` with nobody the wiser.
 */
function policy(): Map<string, string> {
  const response = proxy(new NextRequest("https://minimumstress.app/"));
  const header = response.headers.get("content-security-policy") ?? "";

  return new Map(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const space = part.indexOf(" ");
        return space === -1 ? [part, ""] : [part.slice(0, space), part.slice(space + 1)];
      }),
  );
}

describe("the content security policy", () => {
  it("is sent at all", () => {
    expect(policy().size).toBeGreaterThan(5);
  });

  it("defaults to refusing everything off our own origin", () => {
    expect(policy().get("default-src")).toBe("'self'");
  });

  /** Both are the host's own uploads, out of the same bucket. */
  it.each(["img-src", "media-src"])("lets %s reach the storage bucket", (directive) => {
    expect(policy().get(directive)).toMatch(/supabase/);
  });

  it("allows the local preview a host sees before an upload finishes", () => {
    expect(policy().get("img-src")).toContain("blob:");
    expect(policy().get("media-src")).toContain("blob:");
  });

  /**
   * Not a style choice. What would be framed here is a card authorisation,
   * and an invisible frame over a real payment sheet is the attack.
   */
  it("refuses to be framed by anyone", () => {
    expect(policy().get("frame-ancestors")).toBe("'none'");
  });

  it("runs scripts only from our origin under a fresh nonce", () => {
    const first = policy().get("script-src") ?? "";
    const second = policy().get("script-src") ?? "";

    expect(first).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(first).not.toBe(second);
    expect(first).not.toContain("'unsafe-inline'");
    expect(first).not.toContain("'unsafe-eval'");
  });

  /**
   * Address lookups are proxied through our own server precisely so a host's
   * half-typed home address never leaves their machine for a third party. A
   * geocoder appearing here would mean that stopped being true.
   */
  it("keeps the geocoder out of connect-src", () => {
    const connect = policy().get("connect-src") ?? "";

    expect(connect).not.toMatch(/google|locationiq|photon|nominatim/i);
    expect(connect).toMatch(/supabase/);
  });
});
