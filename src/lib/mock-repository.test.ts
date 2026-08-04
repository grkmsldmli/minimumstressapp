import { beforeEach, describe, expect, it } from "vitest";

import { MockRepository } from "./mock-repository";
import { INSTANT_FEE_CENTS } from "./money";

let repo: MockRepository;

beforeEach(() => {
  repo = new MockRepository();
});

/** A time on a day the seeded spaces are open, comfortably outside every window. */
function daysFromNow(days: number, hour = 10): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hour, 0, 0, 0);
}

async function firstSpaceId(): Promise<string> {
  const [space] = await repo.listPublicSpaces();
  return space.id;
}

describe("a brand-new account starts genuinely empty", () => {
  it("has no listings, bookings, credit, or Pro", async () => {
    expect(await repo.listMySpaces()).toEqual([]);
    expect(await repo.listMyBookings()).toEqual([]);
    expect(await repo.listHostBookings()).toEqual([]);
    expect(await repo.getCreditBalanceCents()).toBe(0);
    expect((await repo.getProfile()).isPro).toBe(false);
  });

  it("still shows other hosts' listings, because a marketplace has them", async () => {
    expect((await repo.listPublicSpaces()).length).toBeGreaterThan(0);
  });
});

describe("pricing flows through the money module", () => {
  it("charges the all-in price and pays the host their rate exactly", async () => {
    const spaceId = await firstSpaceId();
    const space = await repo.getPublicSpace(spaceId);
    const booking = await repo.createBooking({ spaceId, startsAt: daysFromNow(3) });

    expect(space!.hourlyRateCents).toBe(4500);
    expect(booking.hostRateCents).toBe(4500);
    expect(booking.serviceFeeCents).toBe(900);
    expect(booking.totalCents).toBe(5400);
    expect(booking.totalCents).toBe(booking.hostRateCents + booking.platformCents);
  });

  it("adds the instant fee only inside the two-hour window", async () => {
    const spaceId = await firstSpaceId();

    const soon = new Date(Date.now() + 30 * 60 * 1000);
    const instant = await repo.createBooking({ spaceId, startsAt: soon });
    expect(instant.isInstant).toBe(true);
    expect(instant.instantFeeCents).toBe(INSTANT_FEE_CENTS);

    const later = await repo.createBooking({ spaceId, startsAt: daysFromNow(2) });
    expect(later.isInstant).toBe(false);
    expect(later.instantFeeCents).toBe(0);
  });

  it("waives the instant fee and discounts the total for Pro", async () => {
    await repo.startProSubscription();
    const spaceId = await firstSpaceId();

    const booking = await repo.createBooking({
      spaceId,
      startsAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    expect(booking.wasPro).toBe(true);
    expect(booking.instantFeeCents).toBe(0);
    expect(booking.proDiscountCents).toBe(540);
    expect(booking.totalCents).toBe(4860);
    expect(booking.hostRateCents).toBe(4500);
  });

  it("freezes the price so a later rate change cannot rewrite it", async () => {
    const spaceId = await firstSpaceId();
    const booking = await repo.createBooking({ spaceId, startsAt: daysFromNow(3) });
    const originalTotal = booking.totalCents;

    // Whatever happens to the listing afterwards, the booking keeps its quote.
    const [stored] = await repo.listMyBookings();
    expect(stored.totalCents).toBe(originalTotal);
    expect(stored.hostRateCents).toBe(4500);
  });
});

describe("cancellation", () => {
  it("charges nothing when the practitioner cancels well ahead", async () => {
    const spaceId = await firstSpaceId();
    const booking = await repo.createBooking({ spaceId, startsAt: daysFromNow(3) });

    const cancelled = await repo.cancelBooking(booking.id, "practitioner");

    expect(cancelled.status).toBe("cancelled_by_practitioner");
    expect(await repo.getCreditBalanceCents()).toBe(0);
  });

  it("credits the platform's fee when the host cancels", async () => {
    const spaceId = await firstSpaceId();
    const booking = await repo.createBooking({ spaceId, startsAt: daysFromNow(3) });

    await repo.cancelBooking(booking.id, "host");

    // The $9.00 service fee, and not a cent more.
    expect(await repo.getCreditBalanceCents()).toBe(900);
    const entries = await repo.listCreditEntries();
    expect(entries[0].reason).toContain("cancelled on you");
  });

  it("never lets a host cancellation mint credit beyond what we earned", async () => {
    const spaceId = await firstSpaceId();

    // Build a balance, spend part of it, then have the host cancel.
    const first = await repo.createBooking({ spaceId, startsAt: daysFromNow(3) });
    await repo.cancelBooking(first.id, "host");
    const balanceBefore = await repo.getCreditBalanceCents();

    const second = await repo.createBooking({ spaceId, startsAt: daysFromNow(4) });
    expect(second.creditAppliedCents).toBeGreaterThan(0);

    await repo.cancelBooking(second.id, "host");
    const balanceAfter = await repo.getCreditBalanceCents();

    // Spent credit comes back, plus exactly the platform's net take.
    expect(balanceAfter - balanceBefore).toBe(second.platformCents);
  });

  it("keeps spent credit when the practitioner cancels late", async () => {
    const spaceId = await firstSpaceId();
    const first = await repo.createBooking({ spaceId, startsAt: daysFromNow(3) });
    await repo.cancelBooking(first.id, "host");

    const soon = new Date(Date.now() + 45 * 60 * 1000);
    const second = await repo.createBooking({ spaceId, startsAt: soon });
    const balanceAfterSpending = await repo.getCreditBalanceCents();

    await repo.cancelBooking(second.id, "practitioner");

    // They were charged in full, so the credit they spent stays spent.
    expect(await repo.getCreditBalanceCents()).toBe(balanceAfterSpending);
  });
});

describe("the credit ledger is append-only", () => {
  it("derives the balance from its entries", async () => {
    const spaceId = await firstSpaceId();
    const booking = await repo.createBooking({ spaceId, startsAt: daysFromNow(3) });
    await repo.cancelBooking(booking.id, "host");

    const entries = await repo.listCreditEntries();
    const summed = entries.reduce((total, entry) => total + entry.deltaCents, 0);

    expect(summed).toBe(await repo.getCreditBalanceCents());
  });
});

describe("the address is withheld until there is a booking", () => {
  it("returns nothing before booking", async () => {
    expect(await repo.getSpaceAccessDetails(await firstSpaceId())).toBeNull();
  });

  it("releases it once a booking exists", async () => {
    const spaceId = await firstSpaceId();
    await repo.createBooking({ spaceId, startsAt: daysFromNow(3) });

    const details = await repo.getSpaceAccessDetails(spaceId);

    expect(details?.addressLine).toBeTruthy();
    expect(details?.entryInstructions).toBeTruthy();
  });
});

describe("the access code is withheld until its reveal time", () => {
  it("hides it on a booking days away", async () => {
    const spaceId = await firstSpaceId();
    const booking = await repo.createBooking({ spaceId, startsAt: daysFromNow(3) });

    expect(booking.revealedAccessCode).toBeNull();
    expect(booking.accessCodeRevealedAt.getTime()).toBeLessThan(booking.startsAt.getTime());
  });

  it("releases it within the final half hour", async () => {
    const spaceId = await firstSpaceId();
    const booking = await repo.createBooking({
      spaceId,
      startsAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    expect(booking.revealedAccessCode).toMatch(/^\d{4}$/);
  });
});

describe("listing a space", () => {
  it("starts pending and stays out of Discover until reviewed", async () => {
    const before = (await repo.listPublicSpaces()).length;

    const space = await repo.createSpace({
      name: "Test Room",
      category: "spirit",
      hourlyRateCents: 3000,
      capacity: 4,
      accessType: "lockbox",
      entryInstructions: "Lockbox by the side gate",
      addressLine: "1 Test Street",
      lat: 37.5485,
      lng: -122.3122,
      mapX: 50,
      mapY: 50,
      accessible: true,
      restroom: "Private",
      amenities: ["Storage"],
      requirements: [],
      houseRules: "",
      bufferMinutes: 15,
      availability: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
      media: [{ url: "blob:test", kind: "image" }],
      subleaseDocName: "lease.pdf",
      insuranceDocName: null,
    });

    expect(space.status).toBe("pending");
    expect((await repo.listPublicSpaces()).length).toBe(before);

    await repo.approveSpace(space.id);
    expect((await repo.listPublicSpaces()).length).toBe(before + 1);
  });

  it("invents no earnings when a listing is approved", async () => {
    const space = await repo.createSpace({
      name: "Test Room",
      category: "physical",
      hourlyRateCents: 3000,
      capacity: 4,
      accessType: "keypad",
      entryInstructions: "Panel by the door",
      addressLine: "1 Test Street",
      lat: 37.5485,
      lng: -122.3122,
      mapX: 50,
      mapY: 50,
      accessible: null,
      restroom: null,
      amenities: [],
      requirements: [],
      houseRules: "",
      bufferMinutes: 0,
      availability: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
      media: [{ url: "blob:test", kind: "image" }],
      subleaseDocName: "lease.pdf",
      insuranceDocName: null,
    });

    await repo.approveSpace(space.id);

    // The prototype conjured a month of revenue and a booking here.
    expect(await repo.listHostBookings()).toEqual([]);
  });

  it("merges overlapping availability blocks on save", async () => {
    const space = await repo.createSpace({
      name: "Test Room",
      category: "physical",
      hourlyRateCents: 3000,
      capacity: 4,
      accessType: "keypad",
      entryInstructions: "Panel by the door",
      addressLine: "1 Test Street",
      lat: 37.5485,
      lng: -122.3122,
      mapX: 50,
      mapY: 50,
      accessible: null,
      restroom: null,
      amenities: [],
      requirements: [],
      houseRules: "",
      bufferMinutes: 0,
      availability: [
        { weekday: 1, startMinute: 540, endMinute: 720 },
        { weekday: 1, startMinute: 660, endMinute: 1020 },
      ],
      media: [{ url: "blob:test", kind: "image" }],
      subleaseDocName: "lease.pdf",
      insuranceDocName: null,
    });

    expect(space.availability).toEqual([{ weekday: 1, startMinute: 540, endMinute: 1020 }]);
  });
});

describe("simulated inbound bookings pay the host their rate", () => {
  it("lands on an hour the host actually opened", async () => {
    const space = await repo.createSpace({
      name: "Test Room",
      category: "physical",
      hourlyRateCents: 3300,
      capacity: 4,
      accessType: "keypad",
      entryInstructions: "Panel by the door",
      addressLine: "1 Test Street",
      lat: 37.5485,
      lng: -122.3122,
      mapX: 50,
      mapY: 50,
      accessible: null,
      restroom: null,
      amenities: [],
      requirements: [],
      houseRules: "",
      bufferMinutes: 0,
      // Open every day, so there is always a next slot regardless of when
      // this test runs.
      availability: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        startMinute: 0,
        endMinute: 1440,
      })),
      media: [{ url: "blob:test", kind: "image" }],
      subleaseDocName: "lease.pdf",
      insuranceDocName: null,
    });
    await repo.approveSpace(space.id);

    const booking = await repo.simulateInboundBooking(space.id);

    expect(booking).not.toBeNull();
    expect(booking!.netCents).toBe(3300);
    expect(booking!.startsAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("refuses to book a listing that is still pending review", async () => {
    const space = await repo.createSpace({
      name: "Test Room",
      category: "physical",
      hourlyRateCents: 3300,
      capacity: 4,
      accessType: "keypad",
      entryInstructions: "Panel by the door",
      addressLine: "1 Test Street",
      lat: 37.5485,
      lng: -122.3122,
      mapX: 50,
      mapY: 50,
      accessible: null,
      restroom: null,
      amenities: [],
      requirements: [],
      houseRules: "",
      bufferMinutes: 0,
      availability: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
      media: [{ url: "blob:test", kind: "image" }],
      subleaseDocName: "lease.pdf",
      insuranceDocName: null,
    });

    expect(await repo.simulateInboundBooking(space.id)).toBeNull();
  });
});
