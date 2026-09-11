// @vitest-environment jsdom

/**
 * The invite-from-roster flow, as a host sees it. An invite only ever notifies —
 * so these pin that you can't invite the same person twice, can't invite someone
 * who isn't taking work, and that a single tap sends a single invite.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RosterMember } from "@/lib/domain";
import { RosterScreen } from "./roster";

afterEach(cleanup);

const member = (over: Partial<RosterMember>): RosterMember => ({
  id: "ros_x",
  practitionerId: "prac_x",
  displayName: "A Professional",
  avatarUrl: null,
  craft: "Pilates",
  foundingPractitioner: false,
  note: null,
  timesWorkedTogether: 2,
  availableForWork: true,
  addedAt: new Date("2026-01-01T00:00:00Z"),
  ...over,
});

const A = member({ id: "ros_a", practitionerId: "prac_a", displayName: "Ava Available" });
const B = member({ id: "ros_b", practitionerId: "prac_b", displayName: "Bo Invited" });
const C = member({ id: "ros_c", practitionerId: "prac_c", displayName: "Cy Unavailable", availableForWork: false });

const noop = () => {};

describe("RosterScreen — invite mode", () => {
  it("invites an available, un-invited member exactly once", () => {
    const onInvite = vi.fn();
    render(
      <RosterScreen
        members={[A]}
        invite={{ invitedIds: new Set(), busyIds: new Set(), onInvite }}
        onRefresh={noop}
        onBack={noop}
      />,
    );
    const button = screen.getByRole("button", { name: "Invite" });
    fireEvent.click(button);
    expect(onInvite).toHaveBeenCalledTimes(1);
    expect(onInvite).toHaveBeenCalledWith("prac_a");
  });

  it("shows an already-invited member as 'Invited' with no invite button (no double-invite)", () => {
    const onInvite = vi.fn();
    render(
      <RosterScreen
        members={[B]}
        invite={{ invitedIds: new Set(["prac_b"]), busyIds: new Set(), onInvite }}
        onRefresh={noop}
        onBack={noop}
      />,
    );
    expect(screen.getByText("Invited")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Invite" })).toBeNull();
  });

  it("shows an ineligible member as 'Unavailable' and offers no invite", () => {
    const onInvite = vi.fn();
    render(
      <RosterScreen
        members={[C]}
        invite={{ invitedIds: new Set(), busyIds: new Set(), onInvite }}
        onRefresh={noop}
        onBack={noop}
      />,
    );
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Invite" })).toBeNull();
  });

  it("an invite in flight is disabled, so a repeat tap sends nothing", () => {
    const onInvite = vi.fn();
    render(
      <RosterScreen
        members={[A]}
        invite={{ invitedIds: new Set(), busyIds: new Set(["prac_a"]), onInvite }}
        onRefresh={noop}
        onBack={noop}
      />,
    );
    const button = screen.getByRole("button", { name: "Inviting…" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onInvite).not.toHaveBeenCalled();
  });

  it("locks each in-flight invite independently — a second invite never frees the first", () => {
    // Both A and B have invites in flight; each must stay disabled on its own,
    // so inviting one can never re-enable another mid-flight.
    render(
      <RosterScreen
        members={[A, B]}
        invite={{ invitedIds: new Set(), busyIds: new Set(["prac_a", "prac_b"]), onInvite: vi.fn() }}
        onRefresh={noop}
        onBack={noop}
      />,
    );
    expect(screen.getAllByRole("button", { name: "Inviting…" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Invite" })).toBeNull();
  });

  it("mixes states across a roster without cross-contaminating", () => {
    render(
      <RosterScreen
        members={[A, B, C]}
        invite={{ invitedIds: new Set(["prac_b"]), busyIds: new Set(), onInvite: vi.fn() }}
        onRefresh={noop}
        onBack={noop}
      />,
    );
    // Exactly one member is invitable.
    expect(screen.getAllByRole("button", { name: "Invite" })).toHaveLength(1);
    expect(screen.getByText("Invited")).toBeTruthy();
    expect(screen.getByText("Unavailable")).toBeTruthy();
  });
});
