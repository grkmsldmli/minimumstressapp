export type CronAttempt<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

export type CronRunWithRetention<T> = {
  operational: CronAttempt<T>;
  retention: CronAttempt<{ analyticsEventsPruned: number }>;
};

async function attempt<T>(run: () => Promise<T>): Promise<CronAttempt<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Retention is deliberately a separate attempt, not another step inside the
 * operational sweep. It still starts after payouts and the other operational
 * work, but an operational failure cannot skip the privacy deadline cleanup.
 */
export async function runWithIndependentRetention<T>(
  runOperational: () => Promise<T>,
  runRetention: () => Promise<{ analyticsEventsPruned: number }>,
): Promise<CronRunWithRetention<T>> {
  const operational = await attempt(runOperational);
  const retention = await attempt(runRetention);

  return { operational, retention };
}
