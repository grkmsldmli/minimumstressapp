import { describe, expect, it } from "vitest";

import { practitionerDocPath, spaceDocPath } from "./uploads";
import { isVerificationDocPath } from "./verification-docs";

/** A UUID-shaped id, the form Supabase auth ids and crypto.randomUUID() take. */
const uuid = () => "123e4567-e89b-42d3-a456-426614174000";

describe("isVerificationDocPath — what the admin route will sign", () => {
  it("accepts the practitioner certificate path the app actually writes", () => {
    // The exact path uploadInsuranceCertificate stores, so admin open works.
    for (const type of ["application/pdf", "image/jpeg", "image/png"]) {
      const path = practitionerDocPath(uuid(), type, uuid());
      expect(path.startsWith("practitioner/")).toBe(true);
      expect(isVerificationDocPath(path)).toBe(true);
    }
  });

  it("accepts the space document path the app actually writes", () => {
    const path = spaceDocPath(uuid(), uuid(), "image/jpeg", uuid());
    expect(isVerificationDocPath(path)).toBe(true);
  });

  it("rejects a bare filename — what the old, broken upload stored", () => {
    expect(isVerificationDocPath("IMG_8031.png")).toBe(false);
    expect(isVerificationDocPath("cert.pdf")).toBe(false);
  });

  it("rejects path traversal and absolute-looking paths", () => {
    expect(isVerificationDocPath(`practitioner/${uuid()}/../secret.pdf`)).toBe(false);
    expect(isVerificationDocPath("practitioner/../secret.pdf")).toBe(false);
    expect(isVerificationDocPath("/etc/passwd")).toBe(false);
    expect(isVerificationDocPath("")).toBe(false);
  });

  it("rejects wrong prefixes, non-uuid segments, and missing segments", () => {
    expect(isVerificationDocPath("avatars/" + uuid() + "/x.png")).toBe(false);
    expect(isVerificationDocPath("practitioner/not-a-uuid/x.pdf")).toBe(false);
    // A space path needs two ids (host and space), not one.
    expect(isVerificationDocPath(`space/${uuid()}/x.pdf`)).toBe(false);
  });
});
