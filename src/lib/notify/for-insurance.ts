import type { SupabaseClient } from "@supabase/supabase-js";

import { recipientFor } from "./for-booking";
import { notify } from "./send";

/**
 * Telling a practitioner what a person decided about their certificate.
 *
 * Called only after the review has actually been written, so the message can
 * never describe a state the row is not in. Two things it must never do, and
 * both are structural rather than best-effort:
 *
 * It must not undo the decision. A verification that landed is the source of
 * truth whether or not an email about it goes out, so every failure in here —
 * a recipient with no address, a lookup that throws, a provider that is down —
 * is swallowed and logged, never raised back to the caller.
 *
 * It must not send twice for one decision. The dedupe key is the certificate
 * being reviewed, not the moment the button was pressed: a double-click or a
 * retry reviews the same stored path and collides on the same key, while a
 * genuinely new certificate — a re-upload after a rejection writes a fresh path
 * — is a new subject and is allowed its own message.
 */
export async function notifyInsuranceReviewed(
  admin: SupabaseClient,
  userId: string,
  review:
    | { outcome: "verified"; certificate: string; expiresLabel: string | null }
    | { outcome: "rejected"; certificate: string; note: string },
): Promise<void> {
  try {
    const recipient = await recipientFor(admin, userId);
    if (!recipient?.email) return;

    if (review.outcome === "verified") {
      await notify({
        kind: "insurance_verified",
        recipient,
        context: { until: review.expiresLabel ?? undefined },
        subjectId: review.certificate,
      });
    } else {
      await notify({
        kind: "insurance_rejected",
        recipient,
        context: { note: review.note },
        subjectId: review.certificate,
      });
    }
  } catch (cause) {
    // A decision that already landed must never be undone by a message about
    // it. Logged so a delivery gap is visible, not raised so it becomes one.
    console.error(`Insurance review email failed for ${userId}:`, cause);
  }
}
