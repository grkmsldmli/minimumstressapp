import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "../supabase/server";
import { notifyNewMessage } from "./for-booking";

const MAX_ATTEMPTS = 12;

interface MessageNotificationJob {
  message_id: string;
  booking_id: string;
  sender_id: string;
  attempts: number;
  lease_token: string;
}

export interface MessageJobResult {
  claimed: number;
  completed: number;
  retrying: number;
  failed: number;
}

/**
 * Turn transactionally-created message jobs into the ordinary notification
 * outbox rows. The provider send may fail; that is already recoverable inside
 * notify(). This job is complete as soon as those deduplicated outbox rows
 * exist, which also makes a crash after enqueue harmless on the next claim.
 */
export async function processMessageNotificationJobs(
  admin: SupabaseClient = supabaseAdmin(),
  options: { limit?: number; messageId?: string; now?: Date } = {},
): Promise<MessageJobResult> {
  const now = options.now ?? new Date();
  const worker = randomUUID();
  const { data, error } = await admin.rpc("claim_message_notification_jobs", {
    p_worker: worker,
    p_limit: options.limit ?? 20,
    p_now: now.toISOString(),
    p_message_id: options.messageId ?? null,
  });
  if (error) throw error;

  const jobs = (data ?? []) as MessageNotificationJob[];
  const outcome: MessageJobResult = {
    claimed: jobs.length,
    completed: 0,
    retrying: 0,
    failed: 0,
  };

  let cursor = 0;
  const work = async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      try {
        await notifyNewMessage(
          admin,
          job.booking_id,
          job.sender_id,
          job.message_id,
          { propagate: true },
        );

        const { error: completeError } = await admin
          .from("message_notification_jobs")
          .update({
            completed_at: new Date().toISOString(),
            lease_token: null,
            lease_until: null,
            last_error: null,
          })
          .eq("message_id", job.message_id)
          .eq("lease_token", job.lease_token);
        if (completeError) throw completeError;
        outcome.completed += 1;
      } catch {
        const terminal = job.attempts >= MAX_ATTEMPTS;
        const { error: failError } = await admin
          .from("message_notification_jobs")
          .update({
            // Controlled diagnostic only: provider/database exceptions can
            // contain addresses or request data and do not belong here.
            last_error: "notification enqueue failed",
            next_attempt_at: nextAttemptAt(job.attempts, now),
            lease_token: null,
            lease_until: null,
            ...(terminal ? { failed_at: now.toISOString() } : {}),
          })
          .eq("message_id", job.message_id)
          .eq("lease_token", job.lease_token);
        if (failError) throw failError;

        if (terminal) outcome.failed += 1;
        else outcome.retrying += 1;
        console.error(`New-message outbox enqueue failed for ${job.message_id}`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(5, jobs.length) }, () => work()));
  return outcome;
}

function nextAttemptAt(attempts: number, from: Date): string {
  const minutes = Math.min(6 * 60, 2 ** Math.max(0, attempts - 1));
  return new Date(from.getTime() + minutes * 60_000).toISOString();
}
