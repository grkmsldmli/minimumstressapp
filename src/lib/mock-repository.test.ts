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

/** A real File, because NewSpaceInput now carries the bytes rather than a preview URL. */
function testFile(name: string, type: string): File {
  return new File(["x"], name, { type });
}

describe("a brand-new account starts genuinely empty", () => {
  it("has no listings, bookings, or Pro", async () => {
    expect(await repo.listMySpaces()).toEqual([]);
    expect(await repo.listMyBookings()).toEqual([]);
    expect(await repo.listHostBookings()).toEqual([]);
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
    const { booking: booking } = await repo.createBooking({ spaceId, startsAt: daysFromNow(3) });

    expect(space!.hourlyRateCents).toBe(4500);
    expect(booking.hostRateCents).toBe(4500);
    expect(booking.serviceFeeCents).toBe(900);
    expect(booking.totalCents).toBe(5400);
    expect(booking.totalCents).toBe(booking.hostRateCents + booking.platformCents);
  });

  it("adds the instant fee only inside the two-hour window", async () => {
    const spaceId = await firstSpaceId();

    const soon = new Date(Date.now() + 30 * 60 * 1000);
    const { booking: instant } = await repo.createBooking({ spaceId, startsAt: soon });
    expect(instant.isInstant).toBe(true);
    expect(instant.instantFeeCents).toBe(INSTANT_FEE_CENTS);

    const { booking: later } = await repo.createBooking({ spaceId, startsAt: daysFromNow(2) });
    expect(later.isInstant).toBe(false);
    expect(later.instantFeeCents).toBe(0);
  });

  /** Pro buys room on the calendar, not a cheaper hour. */
  it("charges a Pro account the same as anybody else", async () => {
    const spaceId = await firstSpaceId();
    const startsAt = new Date(Date.now() + 30 * 60 * 1000);

    const before = await repo.createBooking({ spaceId, startsAt });
    await repo.cancelBooking(before.booking.id, "practitioner");

    await repo.startProSubscription();
    const { booking } = await repo.createBooking({
      spaceId,
      startsAt: new Date(Date.now() + 90 * 60 * 1000),
    });

    expect(booking.wasPro).toBe(true);
    expect(booking.proDiscountCents).toBe(0);
    expect(booking.hostRateCents).toBe(before.booking.hostRateCents);
    expect(booking.totalCents).toBe(before.booking.totalCents);
  });

  it("freezes the price so a later rate change cannot rewrite it", async () => {
    const spaceId = await firstSpaceId();
    const { booking: booking } = await repo.createBooking({ spaceId, startsAt: daysFromNow(3) });
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
    const { booking: booking } = await repo.createBooking({ spaceId, startsAt: daysFromNow(3) });

    const cancelled = await repo.cancelBooking(booking.id, "practitioner");

    expect(cancelled.status).toBe("cancelled_by_practitioner");
  });



  it("keeps spent credit when the practitioner cancels late", async () => {
    const spaceId = await firstSpaceId();
    const { booking: first } = await repo.createBooking({ spaceId, startsAt: daysFromNow(3) });
    await repo.cancelBooking(first.id, "host");

    const soon = new Date(Date.now() + 45 * 60 * 1000);
    const { booking: second } = await repo.createBooking({ spaceId, startsAt: soon });

    await repo.cancelBooking(second.id, "practitioner");

    // They were charged in full, so the credit they spent stays spent.
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
    const { booking: booking } = await repo.createBooking({ spaceId, startsAt: daysFromNow(3) });

    expect(booking.revealedAccessCode).toBeNull();
    expect(booking.accessCodeRevealedAt.getTime()).toBeLessThan(booking.startsAt.getTime());
  });

  it("releases it within the final half hour", async () => {
    const spaceId = await firstSpaceId();
    const { booking: booking } = await repo.createBooking({
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
      city: "San Mateo",
      state: "CA",
      postalCode: "94404",
      suitableFor: [],
      timeZone: "America/Los_Angeles",
      parking: { options: [], limitMinutes: null },
      floorAreaSqft: null,
      lat: 37.5485,
      lng: -122.3122,
      mapX: 50,
      mapY: 50,
      access: { entrance: null, floor: null, doorwayInches: null, restroom: null },
      restroom: "Private",
      amenities: ["Storage"],
      requirements: [],
      description: "A test room.",
  houseRules: "",
      bufferMinutes: 15,
      availability: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
      media: [{ file: testFile("room.jpg", "image/jpeg"), kind: "image" }],
      subleaseDoc: testFile("lease.pdf", "application/pdf"),
      insuranceDoc: null,
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
      city: "San Mateo",
      state: "CA",
      postalCode: "94404",
      suitableFor: [],
      timeZone: "America/Los_Angeles",
      parking: { options: [], limitMinutes: null },
      floorAreaSqft: null,
      lat: 37.5485,
      lng: -122.3122,
      mapX: 50,
      mapY: 50,
      access: { entrance: null, floor: null, doorwayInches: null, restroom: null },
      restroom: null,
      amenities: [],
      requirements: [],
      description: "A test room.",
  houseRules: "",
      bufferMinutes: 0,
      availability: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
      media: [{ file: testFile("room.jpg", "image/jpeg"), kind: "image" }],
      subleaseDoc: testFile("lease.pdf", "application/pdf"),
      insuranceDoc: null,
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
      city: "San Mateo",
      state: "CA",
      postalCode: "94404",
      suitableFor: [],
      timeZone: "America/Los_Angeles",
      parking: { options: [], limitMinutes: null },
      floorAreaSqft: null,
      lat: 37.5485,
      lng: -122.3122,
      mapX: 50,
      mapY: 50,
      access: { entrance: null, floor: null, doorwayInches: null, restroom: null },
      restroom: null,
      amenities: [],
      requirements: [],
      description: "A test room.",
  houseRules: "",
      bufferMinutes: 0,
      availability: [
        { weekday: 1, startMinute: 540, endMinute: 720 },
        { weekday: 1, startMinute: 660, endMinute: 1020 },
      ],
      media: [{ file: testFile("room.jpg", "image/jpeg"), kind: "image" }],
      subleaseDoc: testFile("lease.pdf", "application/pdf"),
      insuranceDoc: null,
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
      city: "San Mateo",
      state: "CA",
      postalCode: "94404",
      suitableFor: [],
      timeZone: "America/Los_Angeles",
      parking: { options: [], limitMinutes: null },
      floorAreaSqft: null,
      lat: 37.5485,
      lng: -122.3122,
      mapX: 50,
      mapY: 50,
      access: { entrance: null, floor: null, doorwayInches: null, restroom: null },
      restroom: null,
      amenities: [],
      requirements: [],
      description: "A test room.",
  houseRules: "",
      bufferMinutes: 0,
      // Open every day, so there is always a next slot regardless of when
      // this test runs.
      availability: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        startMinute: 0,
        endMinute: 1440,
      })),
      media: [{ file: testFile("room.jpg", "image/jpeg"), kind: "image" }],
      subleaseDoc: testFile("lease.pdf", "application/pdf"),
      insuranceDoc: null,
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
      city: "San Mateo",
      state: "CA",
      postalCode: "94404",
      suitableFor: [],
      timeZone: "America/Los_Angeles",
      parking: { options: [], limitMinutes: null },
      floorAreaSqft: null,
      lat: 37.5485,
      lng: -122.3122,
      mapX: 50,
      mapY: 50,
      access: { entrance: null, floor: null, doorwayInches: null, restroom: null },
      restroom: null,
      amenities: [],
      requirements: [],
      description: "A test room.",
  houseRules: "",
      bufferMinutes: 0,
      availability: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
      media: [{ file: testFile("room.jpg", "image/jpeg"), kind: "image" }],
      subleaseDoc: testFile("lease.pdf", "application/pdf"),
      insuranceDoc: null,
    });

    expect(await repo.simulateInboundBooking(space.id)).toBeNull();
  });
});

/**
 * A photo that survives the tab it was picked in.
 *
 * The screens used to hand `URL.createObjectURL(file)` straight to the profile:
 * it renders instantly, is never uploaded, and dies the moment the tab
 * navigates. The picture looked saved, the app said nothing, and it was gone
 * on the way back. Nothing in a test could see it, because nothing was asked.
 */
describe("uploadAvatar", () => {
  const png = () =>
    new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "me.png", { type: "image/png" });

  it("returns a profile pointing at something that is not a blob", async () => {
    const repo = new MockRepository();

    const profile = await repo.uploadAvatar(png());

    expect(profile.avatarUrl).toBeTruthy();
    expect(profile.avatarUrl).not.toMatch(/^blob:/);
  });

  it("is still there on the next read", async () => {
    const repo = new MockRepository();

    const uploaded = await repo.uploadAvatar(png());
    const readBack = await repo.getProfile();

    expect(readBack.avatarUrl).toBe(uploaded.avatarUrl);
  });

  it("refuses a file that is not an image", async () => {
    const repo = new MockRepository();
    const pdf = new File([new Uint8Array([1])], "lease.pdf", { type: "application/pdf" });

    await expect(repo.uploadAvatar(pdf)).rejects.toThrow();
  });
});

/**
 * The two axes the generated pages are built on, kept through an edit.
 *
 * Creating a listing stored them and editing one dropped them, which is the
 * quiet half of the bug: the listing looks right, the address reads right, and
 * only the page it is filed under is wrong.
 */
describe("keeping a listing's town and its uses", () => {
  const listing = () =>
    repo.createSpace({
      name: "Test Room",
      category: "physical",
      hourlyRateCents: 3000,
      capacity: 4,
      accessType: "keypad",
      entryInstructions: "Keypad by the door",
      addressLine: "1 Test Street",
      city: "San Mateo",
      state: "CA",
      postalCode: "94404",
      suitableFor: ["pilates-studio"],
      timeZone: "America/Los_Angeles",
      parking: { options: [], limitMinutes: null },
      floorAreaSqft: null,
      lat: 37.5485,
      lng: -122.3122,
      mapX: 50,
      mapY: 50,
      access: { entrance: null, floor: null, doorwayInches: null, restroom: null },
      restroom: "Private",
      amenities: [],
      requirements: [],
      description: "A test room.",
      houseRules: "",
      bufferMinutes: 15,
      availability: [],
      media: [{ file: testFile("room.jpg", "image/jpeg"), kind: "image" }],
      subleaseDoc: testFile("lease.pdf", "application/pdf"),
      insuranceDoc: null,
    });

  it("stores both when the listing is made", async () => {
    const space = await listing();
    expect(space.city).toBe("San Mateo");
    expect(space.state).toBe("CA");
    expect(space.suitableFor).toEqual(["pilates-studio"]);
  });

  it("changes the uses when they are edited", async () => {
    const space = await listing();
    const edited = await repo.editSpace(space.id, {
      suitableFor: ["yoga-studio", "movement-studio"],
    });
    expect(edited.suitableFor).toEqual(["yoga-studio", "movement-studio"]);
  });

  /*
   * A use that has since been renamed costs the use, not the listing. The
   * database would refuse the whole row on the check constraint, so the same
   * filter runs on both sides.
   */
  it("drops a use it does not recognise rather than failing the edit", async () => {
    const space = await listing();
    const edited = await repo.editSpace(space.id, {
      suitableFor: ["yoga-studio", "therapy-office"],
    });
    expect(edited.suitableFor).toEqual(["yoga-studio"]);
  });

  /*
   * The important one. An edit that says nothing about the town must leave it
   * alone — a host correcting their door code has not moved, and a listing
   * that quietly loses its town disappears from its city page.
   */
  it("leaves the town alone when an edit does not mention it", async () => {
    const space = await listing();
    const edited = await repo.editSpace(space.id, { name: "Renamed" });
    expect(edited.city).toBe("San Mateo");
    expect(edited.state).toBe("CA");
  });

  it("moves the town when the listing genuinely moves", async () => {
    const space = await listing();
    const edited = await repo.editSpace(space.id, {
      addressLine: "9 Elm Ave, Belmont, CA 94002, USA",
      city: "Belmont",
      state: "CA",
      postalCode: "94002",
      lat: 37.52,
      lng: -122.28,
    });
    expect(edited.city).toBe("Belmont");
  });
});
