import { describe, expect, it } from "vitest";

import { errorMessage } from "./error-message";

/**
 * The shapes actually thrown at these screens.
 *
 * Nine call sites each wrote `cause instanceof Error ? cause.message : "..."`,
 * which is false for every one of the objects below — so every database
 * refusal arrived as the generic fallback, and one screen rendered a plain
 * object as "[object Object]".
 */
describe("errorMessage", () => {
  it("reads a real Error", () => {
    expect(errorMessage(new Error("Card declined"), "fallback")).toBe("Card declined");
  });

  /** What Supabase throws from a table write. Not an Error. */
  it("reads a PostgrestError, which is a plain object", () => {
    const thrown = {
      message: "new row violates row-level security policy",
      details: null,
      hint: null,
      code: "42501",
    };
    expect(errorMessage(thrown, "fallback")).toBe(
      "new row violates row-level security policy",
    );
  });

  it("reads a StorageError", () => {
    expect(errorMessage({ error: "Payload too large", statusCode: "413" }, "fallback")).toBe(
      "Payload too large",
    );
  });

  it("reads an OAuth-style error_description", () => {
    expect(errorMessage({ error_description: "Token has expired" }, "fallback")).toBe(
      "Token has expired",
    );
  });

  /**
   * The message a trigger raises is written for this moment. It used to be
   * discarded and replaced with "That did not save."
   */
  it("keeps the sentence a trigger raised", () => {
    const raised = {
      message:
        "ERROR: This space has 2 upcoming sessions. Its address and room type cannot change until those sessions are done or cancelled.  CONTEXT: PL/pgSQL function enforce_listing_edit_rules() line 18",
      code: "23514",
    };
    const shown = errorMessage(raised, "That did not save.");

    expect(shown).toContain("2 upcoming sessions");
    expect(shown).not.toContain("CONTEXT");
    expect(shown).not.toContain("PL/pgSQL");
    expect(shown).not.toMatch(/^ERROR:/);
  });

  /** This is what put "[object Object]" on a screen. */
  it("falls back rather than stringifying an object", () => {
    expect(errorMessage({ status: 401 }, "Something went wrong.")).toBe("Something went wrong.");
    expect(errorMessage(null, "Something went wrong.")).toBe("Something went wrong.");
    expect(errorMessage(undefined, "Something went wrong.")).toBe("Something went wrong.");
  });

  /** A person cannot act on a constraint name. */
  it("refuses machinery that happens to be a string", () => {
    expect(errorMessage({ message: "23514" }, "fallback")).toBe("fallback");
    expect(errorMessage({ message: "profiles_terms_consistent" }, "fallback")).toBe("fallback");
    expect(errorMessage({ message: "  " }, "fallback")).toBe("fallback");
  });

  it("takes a bare string", () => {
    expect(errorMessage("Already booked", "fallback")).toBe("Already booked");
  });
});
