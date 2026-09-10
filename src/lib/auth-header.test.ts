import { describe, expect, it } from "vitest";

import { bearerToken } from "./auth-header";

/**
 * The header the native shell signs its API calls with, parsed the one way the
 * server and the client both rely on.
 */
describe("bearerToken", () => {
  it("reads the token out of a Bearer header", () => {
    expect(bearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
  });

  it("is nothing when there is no header — the web's cookie path", () => {
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken("")).toBeNull();
  });

  it("ignores a header that is not a Bearer, or is empty after the scheme", () => {
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken("bearer abc")).toBeNull(); // scheme is case-sensitive here
    expect(bearerToken("Bearer ")).toBeNull();
    expect(bearerToken("Bearer")).toBeNull();
  });

  it("trims surrounding whitespace without splitting the token", () => {
    expect(bearerToken("  Bearer abc.def  ")).toBe("abc.def");
  });
});
