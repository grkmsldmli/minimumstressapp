/**
 * The state of one roster member's invite control, as a pure function so the
 * rules (no double-invite, a safe unavailable state, an in-flight state) are
 * testable without rendering.
 *
 * An invite is only ever a notification — never an assignment — so the control
 * exists to stop a host inviting the same person twice or tapping through a
 * request in flight, and to make plain when someone can't be invited at all.
 */
export type InviteControl = "invite" | "inviting" | "invited" | "unavailable";

export function inviteControlState(
  member: { availableForWork: boolean },
  invited: boolean,
  busy: boolean,
): InviteControl {
  // Already invited wins over everything — the host has acted, and the row
  // should say so even if the member later turns unavailable.
  if (invited) return "invited";
  // An invite in flight for this member — the button is spent until it settles.
  if (busy) return "inviting";
  // No longer taking work: a safe, reasonless "unavailable" (never why), so the
  // host can't fire an invite into an account that isn't listening.
  if (!member.availableForWork) return "unavailable";
  return "invite";
}

/** Whether tapping the control should actually send an invite. */
export function canSendInvite(control: InviteControl): boolean {
  return control === "invite";
}
