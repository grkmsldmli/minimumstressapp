// @vitest-environment jsdom

/**
 * The actions that used to lie when they failed.
 *
 * Each fired its request and then told the person it had worked, without
 * waiting to find out. On a good network that is invisible; on a bad one it
 * produces the worst thing this app can do, which is somebody acting on
 * something that did not happen:
 *
 *   - a practitioner who believes a session is cancelled does not turn up, is
 *     charged in full, and takes a no-show against their standing;
 *   - a host who believes their hours saved leaves a room open on times it was
 *     never given, or shut on times it was;
 *   - somebody who believes they bought Pro is congratulated for a card that
 *     was declined;
 *   - a name that did not save stays in the field, so what is on screen and
 *     what is stored are two different names.
 *
 * And one that failed the other way: the milestone screen renders in front of
 * everything, so a write that did not land meant "Thanks" did nothing at all
 * and a congratulation locked somebody out of their own account.
 *
 * These assert the failure is visible and the claim is not made. They exist
 * because all of it shipped, and the reason it shipped is that nothing in the
 * suite could press a button. The fixtures come from MockRepository rather
 * than being written out here, so a change to the domain breaks these at the
 * type level instead of leaving them passing against a shape the app no
 * longer uses.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { MyBookings } from "@/components/screens/bookings";
import { EditAvailability } from "@/components/screens/host";
import { ProScreen, ProfileHeader } from "@/components/screens/practitioner-extras";
import { MilestoneMoment } from "@/components/milestone-moment";
import { MILESTONES } from "@/lib/milestones";
import type { Booking, HostSpace } from "@/lib/domain";
import { MockRepository } from "@/lib/mock-repository";
import { standingFor } from "@/lib/reliability";

beforeAll(() => {
  window.scrollTo = () => {};
  /*
   * The Pro success screen throws confetti at a canvas, and jsdom has no 2D
   * context to give it — an unhandled "Not implemented" on every run, from a
   * decoration none of these tests look at. Returning null is what a browser
   * does for an unsupported context type, and ConfettiBurst already handles it.
   */
  HTMLCanvasElement.prototype.getContext = () => null;
});

afterEach(cleanup);

const CLEAR = standingFor("practitioner", [], new Date());

let booking: Booking;
let space: HostSpace;

beforeAll(async () => {
  const repo = new MockRepository();

  const spaces = await repo.listPublicSpaces();
  // Ten days out, so cancelling is free and nothing else stands in the way of
  // the button being pressed.
  const startsAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  startsAt.setMinutes(0, 0, 0);
  const created = await repo.createBooking({ spaceId: spaces[0].id, startsAt });
  booking = created.booking;

  space = await repo.createSpace({
    name: "Garden Room",
    category: spaces[0].category,
    hourlyRateCents: 4500,
    capacity: 2,
    accessType: spaces[0].accessType,
    entryInstructions: "Side gate.",
    addressLine: "12 Willow St, Redwood City, CA 94061",
    lat: 37.48,
    lng: -122.23,
    mapX: 0.5,
    mapY: 0.5,
    timeZone: "America/Los_Angeles",
    parking: spaces[0].parking,
    floorAreaSqft: null,
    access: spaces[0].access,
    restroom: spaces[0].restroom,
    bufferMinutes: 0,
    amenities: [],
    requirements: [],
    houseRules: "",
    description: "A quiet room.",
    media: [],
    availability: [],
    subleaseDoc: new File(["lease"], "lease.pdf", { type: "application/pdf" }),
    insuranceDoc: null,
  });
});

/** Renders the practitioner's booking list with a single upcoming session. */
function renderBookings(onCancel: (id: string) => Promise<unknown>) {
  render(
    <MyBookings
      bookings={[booking]}
      accessFor={() => null}
      addressFor={() => "12 Willow St"}
      isPro={false}
      onGoPro={() => {}}
      standing={CLEAR}
      onBack={() => {}}
      onCancel={onCancel}
    />,
  );
  // The card is collapsed until it is tapped; the cancel button is inside it.
  fireEvent.click(screen.getByText(booking.spaceName));
}

const cancelButton = () => screen.queryByRole("button", { name: /^cancel booking$/i });

describe("a cancellation that fails", () => {
  it("says so, and leaves the booking where it was", async () => {
    renderBookings(vi.fn().mockRejectedValue(new Error("Network is down")));

    fireEvent.click(cancelButton()!);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Network is down");
    // Still open, still cancellable. The panel closing was itself the lie.
    expect(cancelButton()).not.toBeNull();
  });

  it("closes the card only once the cancellation is real", async () => {
    renderBookings(vi.fn().mockResolvedValue(undefined));

    fireEvent.click(cancelButton()!);

    await waitFor(() => expect(cancelButton()).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("hours that do not save", () => {
  const saveButton = () => screen.getByRole("button", { name: /save|saving/i });

  it("keeps the host on the screen and tells them", async () => {
    const onBack = vi.fn();
    render(
      <EditAvailability
        space={space}
        onBack={onBack}
        onSave={vi.fn().mockRejectedValue(new Error("Could not reach the server"))}
      />,
    );

    fireEvent.click(saveButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not reach the server");
    expect(onBack).not.toHaveBeenCalled();
    expect(saveButton().textContent).toMatch(/save hours/i);
  });

  it("says Saved once they are", async () => {
    render(
      <EditAvailability
        space={space}
        onBack={() => {}}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(saveButton());

    await waitFor(() => expect(saveButton().textContent).toMatch(/saved/i));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("a profile edit that does not save", () => {
  const nameField = () => screen.getByLabelText("Your name") as HTMLInputElement;

  it("puts the name back rather than showing one that was not stored", async () => {
    render(
      <ProfileHeader
        onBack={() => {}}
        avatarUrl={null}
        onPickAvatar={vi.fn().mockResolvedValue(undefined)}
        name="Ada"
        onName={vi.fn().mockRejectedValue(new Error("That name did not save"))}
        sub="2 bookings so far"
      />,
    );

    fireEvent.change(nameField(), { target: { value: "Grace" } });
    fireEvent.blur(nameField());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("That name did not save");
    // What is on screen and what is in the database are never two names.
    expect(nameField().value).toBe("Ada");
  });

  it("keeps a saved name", async () => {
    const onName = vi.fn().mockResolvedValue(undefined);
    render(
      <ProfileHeader
        onBack={() => {}}
        avatarUrl={null}
        onPickAvatar={vi.fn().mockResolvedValue(undefined)}
        name="Ada"
        onName={onName}
        sub="2 bookings so far"
      />,
    );

    fireEvent.change(nameField(), { target: { value: "Grace" } });
    fireEvent.blur(nameField());

    await waitFor(() => expect(onName).toHaveBeenCalledWith("Grace"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(nameField().value).toBe("Grace");
  });
});

describe("a milestone whose dismissal is not recorded", () => {
  it("still lets somebody into their account", async () => {
    /*
     * This screen renders in front of the whole app. Before, a failed write
     * meant "Thanks" did nothing at all, and a congratulation locked somebody
     * out of the account it was congratulating them on.
     */
    const onDone = vi.fn().mockRejectedValue(new Error("Network is down"));
    const seen: string[] = [];

    render(
      <MilestoneMoment
        milestone={MILESTONES[0]}
        onDone={() => {
          seen.push(MILESTONES[0].key);
          return onDone();
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /thanks/i }));

    // The dismissal is local and unconditional; the write is the part allowed
    // to fail. app.tsx holds the same key in dismissedMilestones.
    await waitFor(() => expect(seen).toEqual([MILESTONES[0].key]));
  });
});

describe("a Pro subscription that does not go through", () => {
  const startButton = () => screen.queryByRole("button", { name: /start pro/i });

  it("does not congratulate anybody", async () => {
    render(
      <ProScreen
        isPro={false}
        onBack={() => {}}
        onSubscribe={vi.fn().mockRejectedValue(new Error("Your card was declined"))}
      />,
    );

    fireEvent.click(startButton()!);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Your card was declined");
    // The offer is still on screen, which is the honest state: nothing was
    // bought, and the button is there to try again.
    await waitFor(() => expect(startButton()).not.toBeNull());
  });

  it("congratulates them when it does", async () => {
    render(
      <ProScreen
        isPro={false}
        onBack={() => {}}
        onSubscribe={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(startButton()!);

    await waitFor(() => expect(startButton()).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
