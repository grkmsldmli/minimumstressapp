import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every URL we hand to Stripe is followed by a browser, which means a GET.
 *
 * `refresh_url` pointed at `/api/connect/onboard`, a POST-only route, with a
 * comment above it promising that an expired link "has to start onboarding
 * again, not dead-end on an error page". It dead-ended on a 405. Nothing
 * failed on our side, nothing was logged, and the only person who would ever
 * see it is a host whose link expired — the one case the comment was written
 * for.
 *
 * So the rule is checked rather than remembered: a route named as a return or
 * refresh destination must answer a GET.
 */

const APP = join(import.meta.dirname, "..", "app");

/** Every `${origin}/...` string handed to Stripe as somewhere to come back to. */
function destinations(): string[] {
  const found = new Set<string>();

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;

      const source = readFileSync(path, "utf8");
      /*
       * Only the ones built from our own origin. A literal external URL is
       * somebody else's route to answer.
       */
      for (const match of source.matchAll(/`\$\{origin\}(\/[^`]*)`/g)) {
        found.add(match[1]);
      }
    }
  };

  walk(APP);
  return [...found];
}

describe("where Stripe sends people back to", () => {
  const paths = destinations();

  it("finds the destinations to check", () => {
    expect(paths.length).toBeGreaterThan(0);
  });

  it.each(paths)("%s answers a GET", (path) => {
    const segments = path.split("/").filter(Boolean);

    // A page is a GET by definition; only route handlers can be method-bound.
    const asRoute = join(APP, ...segments, "route.ts");
    const asPage = join(APP, ...segments, "page.tsx");

    const exists = (file: string) => {
      try {
        return statSync(file).isFile();
      } catch {
        return false;
      }
    };

    expect(exists(asRoute) || exists(asPage), `${path} does not exist at all`).toBe(true);
    if (!exists(asRoute)) return;

    expect(readFileSync(asRoute, "utf8")).toMatch(/export async function GET\b/);
  });
});
