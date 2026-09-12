// @vitest-environment jsdom

/**
 * Adding or replacing a listing's documents after it exists.
 *
 * The create form collects the sublease proof and (optionally) space insurance,
 * and the edit screen showed their status but gave no way to act on it — so a
 * host who skipped insurance, or whose proof was rejected with a reason, had a
 * "Not added" / "Not accepted" row and nowhere to fix it.
 *
 * The two are deliberately not symmetrical. Insurance can be added or replaced
 * whenever, because it never gated the listing going live. The sublease proof
 * re-upload appears only when it was rejected: replacing it sends the whole
 * listing back for review and off search, which is not something to offer next
 * to a listing that is fine.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { EditSpace } from "@/components/screens/edit-space";
import { MockRepository } from "@/lib/mock-repository";
import type { HostSpace } from "@/lib/domain";

beforeAll(() => {
  window.scrollTo = vi.fn();
  if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => "blob:test");
});

afterEach(cleanup);

async function aSpace(): Promise<HostSpace> {
  const repo = new MockRepository();
  const [seed] = await repo.listPublicSpaces();
  return repo.createSpace({
    name: "Garden Room",
    category: "physical",
    roomSetup: "private_room",
    hourlyRateCents: 4500,
    capacity: 2,
    accessType: seed.accessType,
    entryInstructions: "Side gate.",
    addressLine: "12 Willow St, Redwood City, CA 94061",
    city: "Redwood City",
    state: "CA",
    postalCode: "94061",
    suitableFor: ["pilates-studio"],
    allowedUses: [],
    bookingMode: "instant" as const,
    lat: 37.48,
    lng: -122.23,
    mapX: 0.5,
    mapY: 0.5,
    timeZone: "America/Los_Angeles",
    parking: seed.parking,
    floorAreaSqft: null,
    access: seed.access,
    restroom: seed.restroom,
    bufferMinutes: 0,
    amenities: [],
    requirements: [],
    houseRules: "",
    description: "A quiet room with a wooden floor and a door onto the garden.",
    media: [],
    availability: [],
    subleaseDoc: new File(["lease"], "lease.pdf", { type: "application/pdf" }),
    insuranceDoc: null,
  });
}

function open(space: HostSpace) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <EditSpace
      space={space}
      bookedSessions={0}
      onSave={onSave}
      onAddMedia={vi.fn()}
      onRemoveMedia={vi.fn()}
      onSetListed={vi.fn()}
      onRequestClosure={vi.fn()}
      onReplaceSpace={vi.fn()}
      onEditHours={vi.fn()}
      onBack={vi.fn()}
    />,
  );
  return { onSave };
}

/** The hidden file input inside the DocumentUpload whose hint matches. */
function fileInputByHint(hint: string): HTMLInputElement {
  const label = screen.getByText(hint).closest("label");
  if (!label) throw new Error(`No upload control with hint "${hint}"`);
  const input = label.querySelector('input[type="file"]');
  if (!input) throw new Error(`No file input under hint "${hint}"`);
  return input as HTMLInputElement;
}

describe("space insurance from the edit screen", () => {
  it("offers an uploader even when insurance was never added", async () => {
    const space = await aSpace();
    expect(space.insuranceDocName).toBeNull();
    open(space);
    expect(screen.getByText(/Add space insurance/i)).toBeDefined();
  });

  it("sends the picked insurance file on save", async () => {
    const space = await aSpace();
    const { onSave } = open(space);

    const file = new File(["cert"], "cert.pdf", { type: "application/pdf" });
    fireEvent.change(fileInputByHint("PDF or photo"), { target: { files: [file] } });

    fireEvent.click(screen.getByRole("button", { name: /^Save changes$/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [edit] = onSave.mock.calls[0] as [{ insuranceDoc?: File }];
    expect(edit.insuranceDoc).toBeInstanceOf(File);
    expect(edit.insuranceDoc!.name).toBe("cert.pdf");
  });
});

describe("re-uploading a rejected sublease proof", () => {
  it("shows no re-upload while the proof is not rejected", async () => {
    const space = await aSpace(); // created pending, never rejected
    open(space);
    expect(screen.queryByText(/Replace this document/i)).toBeNull();
  });

  it("offers a re-upload once the proof was rejected, and sends it", async () => {
    const base = await aSpace();
    const rejected: HostSpace = {
      ...base,
      subleaseReview: { state: "rejected", reviewedAt: new Date() },
      reviewNote: "The lease was too blurry to read.",
    };
    const { onSave } = open(rejected);

    // The reviewer's reason is shown, and the re-upload is offered next to it.
    expect(screen.getByText(/too blurry to read/i)).toBeDefined();

    const file = new File(["lease2"], "new-lease.pdf", { type: "application/pdf" });
    fireEvent.change(
      fileInputByHint("Lease clause, landlord letter, or deed"),
      { target: { files: [file] } },
    );

    // The consequence is stated before the host commits.
    expect(screen.getByText(/back for review and off search/i)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /^Save changes$/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [edit] = onSave.mock.calls[0] as [{ subleaseDoc?: File }];
    expect(edit.subleaseDoc).toBeInstanceOf(File);
    expect(edit.subleaseDoc!.name).toBe("new-lease.pdf");
  });
});
