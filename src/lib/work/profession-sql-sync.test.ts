import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PROFESSION_KEYS } from "../professions";

/**
 * The `profession in (...)` checks on class_templates and work_requests are a
 * hand-written mirror of lib/professions, the way profiles.profession is
 * (migration 0057). This pins them: add or remove a profession in TS and this
 * fails until migration 0069 moves with it, so the database can never accept a
 * profession the app does not know or reject one it does.
 */
const MIGRATION = readFileSync(
  fileURLToPath(new URL("../../../supabase/migrations/0069_work.sql", import.meta.url)),
  "utf8",
);

function professionListsIn(sql: string): string[][] {
  const lists: string[][] = [];
  const re = /profession\s+in\s*\(([^)]*)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql)) !== null) {
    const keys = match[1]
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);
    lists.push(keys);
  }
  return lists;
}

describe("0069 profession checks stay in sync with lib/professions", () => {
  const lists = professionListsIn(MIGRATION);

  it("has a profession check on both class_templates and work_requests", () => {
    expect(lists.length).toBe(2);
  });

  it("each check lists exactly the known professions", () => {
    for (const list of lists) {
      expect([...list].sort()).toEqual([...PROFESSION_KEYS].sort());
    }
  });
});
