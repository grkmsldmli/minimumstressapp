import { describe, expect, it } from "vitest";

import {
  flag,
  integer,
  jsonObject,
  oneOf,
  optionalString,
  requiredString,
  timestamp,
  uuid,
} from "./validate";

const request = (body: string) =>
  new Request("https://example.test/api/x", { method: "POST", body });

const ID = "a3f1c2d4-5b6e-4a7c-8d9e-0f1a2b3c4d5e";

describe("jsonObject", () => {
  it("reads a plain object", async () => {
    const result = await jsonObject(request(JSON.stringify({ a: 1 })));
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });

  it("refuses a body that is not JSON", async () => {
    const result = await jsonObject(request("not json"));
    expect(result.ok).toBe(false);
  });

  /**
   * An array is valid JSON and passes a `typeof === "object"` check, after
   * which every field reads as undefined — reported as "field missing" rather
   * than "wrong shape", which sends the caller looking in the wrong place.
   */
  it.each(["[]", "[1,2,3]", "null", '"a string"', "42", "true"])(
    "refuses %s, which is not an object",
    async (body) => {
      const result = await jsonObject(request(body));
      expect(result.ok).toBe(false);
    },
  );
});

describe("requiredString", () => {
  it("trims and returns", () => {
    expect(requiredString({ name: "  Willow  " }, "name")).toEqual({ ok: true, value: "Willow" });
  });

  it.each([{}, { name: "" }, { name: "   " }, { name: 42 }, { name: null }])(
    "refuses %o",
    (body) => {
      expect(requiredString(body, "name").ok).toBe(false);
    },
  );

  it("enforces a ceiling", () => {
    expect(requiredString({ name: "x".repeat(501) }, "name").ok).toBe(false);
    expect(requiredString({ name: "x".repeat(500) }, "name").ok).toBe(true);
  });
});

describe("optionalString", () => {
  it.each([undefined, null])("treats %s as empty", (value) => {
    expect(optionalString({ note: value }, "note")).toEqual({ ok: true, value: "" });
  });

  it("still refuses a wrong type", () => {
    expect(optionalString({ note: 42 }, "note").ok).toBe(false);
  });

  it("still enforces a ceiling", () => {
    expect(optionalString({ note: "x".repeat(5001) }, "note").ok).toBe(false);
  });
});

describe("uuid", () => {
  it("accepts one in either case", () => {
    expect(uuid({ id: ID }, "id")).toEqual({ ok: true, value: ID });
    expect(uuid({ id: ID.toUpperCase() }, "id").ok).toBe(true);
  });

  /**
   * Every id in this schema is a uuid, so a malformed one reaching Postgres
   * comes back as a type error — safe, but surfacing as a 500 on a request
   * that was simply wrong.
   */
  it.each(["", "abc", "1", ID.slice(0, -1), `${ID}extra`, "../../etc/passwd", "' OR 1=1--"])(
    "refuses %s",
    (value) => {
      expect(uuid({ id: value }, "id").ok).toBe(false);
    },
  );
});

describe("timestamp", () => {
  it("returns the Date it parses to", () => {
    const result = timestamp({ at: "2026-08-04T12:00:00Z" }, "at");
    expect(result.ok && result.value.toISOString()).toBe("2026-08-04T12:00:00.000Z");
  });

  it.each(["", "not a date", "2026-13-45", 42, null])("refuses %s", (value) => {
    expect(timestamp({ at: value }, "at").ok).toBe(false);
  });
});

describe("integer", () => {
  it("accepts one inside the range", () => {
    expect(integer({ n: 3 }, "n", { min: 1, max: 5 })).toEqual({ ok: true, value: 3 });
  });

  it("accepts both ends", () => {
    expect(integer({ n: 1 }, "n", { min: 1, max: 5 }).ok).toBe(true);
    expect(integer({ n: 5 }, "n", { min: 1, max: 5 }).ok).toBe(true);
  });

  it.each([0, 6, -1, 100])("refuses %i, outside the range", (n) => {
    expect(integer({ n }, "n", { min: 1, max: 5 }).ok).toBe(false);
  });

  /**
   * Rounding 3.5 decides for the caller whether they meant three or four, and
   * writes a rating nobody gave.
   */
  it.each([3.5, 2.0001, NaN, Infinity, "3", null])("refuses %s rather than rounding", (n) => {
    expect(integer({ n }, "n", { min: 1, max: 5 }).ok).toBe(false);
  });

  it("accepts a float that is exactly an integer", () => {
    expect(integer({ n: 3.0 }, "n", { min: 1, max: 5 }).ok).toBe(true);
  });
});

describe("oneOf", () => {
  const actors = ["practitioner", "host"] as const;

  it("accepts a member", () => {
    expect(oneOf({ actor: "host" }, "actor", actors)).toEqual({ ok: true, value: "host" });
  });

  it("falls back only when the field is absent", () => {
    expect(oneOf({}, "actor", actors, "practitioner")).toEqual({
      ok: true,
      value: "practitioner",
    });
    // Present but wrong is an error, not a reason to use the default.
    expect(oneOf({ actor: "admin" }, "actor", actors, "practitioner").ok).toBe(false);
  });

  it.each(["admin", "", 42, null, "HOST"])("refuses %s", (value) => {
    expect(oneOf({ actor: value }, "actor", actors).ok).toBe(false);
  });

  it("names the allowed values, so the caller can fix it", () => {
    const result = oneOf({ actor: "admin" }, "actor", actors);
    expect(result.ok === false && result.reason).toContain("practitioner");
  });
});

describe("flag", () => {
  it("is true only for exactly true", () => {
    expect(flag({ safetyConcern: true }, "safetyConcern")).toBe(true);
  });

  /** Treating an unexpected value as "ticked" is the wrong way to be wrong. */
  it.each(["true", 1, "yes", {}, [], null, undefined, "false", 0])(
    "treats %s as not ticked",
    (value) => {
      expect(flag({ safetyConcern: value }, "safetyConcern")).toBe(false);
    },
  );
});
