import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Every variable the code reads is written down, and nothing written down
 * carries a value.
 *
 * This is the test that would have caught the two worst bugs in the project.
 * `NEXT_PUBLIC_USE_MOCK` was undocumented, so nobody set it, so production
 * served invented listings and accepted any verification code for three weeks
 * while every other test passed. `ADMIN_EMAILS` was undocumented, so it was
 * set in Vercel and nowhere else, and the operations page 404'd on the machine
 * it was built on — indistinguishable from the page not existing.
 *
 * Both were the same failure: a variable whose absence looks exactly like
 * working software. No unit test can catch that, because the code is correct.
 * Only the list can, and only if the list is checked.
 */

const EXAMPLE = ".env.example";

/** Set by the platform, not by us. Nothing to document. */
const PROVIDED = new Set(["NODE_ENV", "VERCEL_URL", "VERCEL_ENV"]);

function documented(): Map<string, string> {
  const found = new Map<string, string>();
  for (const line of readFileSync(EXAMPLE, "utf8").split(/\r?\n/)) {
    if (line.trimStart().startsWith("#")) continue;
    const at = line.indexOf("=");
    if (at > 0) found.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  return found;
}

function readByCode(): Set<string> {
  // Tracked files only: a scratch file or a build artefact is not the app.
  const files = execFileSync("git", ["ls-files", "src", "next.config.ts"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter((path) => path && !path.endsWith(".test.ts"));

  const names = new Set<string>();
  for (const path of files) {
    for (const [, name] of readFileSync(path, "utf8").matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      if (!PROVIDED.has(name)) names.add(name);
    }
  }
  return names;
}

describe(".env.example", () => {
  it("documents every variable the code reads", () => {
    const known = documented();
    const undocumented = [...readByCode()].filter((name) => !known.has(name)).sort();

    expect(undocumented, `add these to ${EXAMPLE}, with why they matter`).toEqual([]);
  });

  /**
   * The other direction. A variable nobody reads is a line somebody will set
   * carefully, and wonder about for an hour when it changes nothing.
   */
  it("lists nothing the code has stopped reading", () => {
    const used = readByCode();
    const stale = [...documented().keys()].filter((name) => !used.has(name)).sort();

    expect(stale, `nothing reads these — remove them from ${EXAMPLE}`).toEqual([]);
  });

  /**
   * The file is committed, which is the whole point of it, and that only stays
   * safe while it holds names rather than secrets. A real key pasted here is
   * published the moment somebody pushes.
   */
  it("holds no values at all", () => {
    const filled = [...documented().entries()]
      .filter(([, value]) => value !== "")
      .map(([name]) => name);

    expect(filled, `${EXAMPLE} is committed — never put real values in it`).toEqual([]);
  });
});
