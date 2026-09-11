import { describe, expect, it } from "vitest";

import { canSendInvite, inviteControlState } from "./roster-invite";

/**
 * The invite control's whole state machine. An invite is only ever a
 * notification, so these pin the three things that keep it safe: you cannot
 * invite the same person twice, you cannot invite someone who is not taking
 * work, and a tap in flight cannot start a second invite.
 */
const available = { availableForWork: true };
const unavailable = { availableForWork: false };

describe("inviteControlState", () => {
  it("an available, un-invited, idle member can be invited", () => {
    expect(inviteControlState(available, false, false)).toBe("invite");
    expect(canSendInvite(inviteControlState(available, false, false))).toBe(true);
  });

  it("an invite in flight shows 'inviting' and cannot be sent again", () => {
    const s = inviteControlState(available, false, true);
    expect(s).toBe("inviting");
    expect(canSendInvite(s)).toBe(false);
  });

  it("an already-invited member shows 'invited' and cannot be re-invited", () => {
    const s = inviteControlState(available, true, false);
    expect(s).toBe("invited");
    expect(canSendInvite(s)).toBe(false);
  });

  it("invited wins even if the member later goes unavailable, or a tap is mid-flight", () => {
    expect(inviteControlState(unavailable, true, false)).toBe("invited");
    expect(inviteControlState(available, true, true)).toBe("invited");
  });

  it("an unavailable member is a safe dead end — never invitable", () => {
    const s = inviteControlState(unavailable, false, false);
    expect(s).toBe("unavailable");
    expect(canSendInvite(s)).toBe(false);
  });
});
