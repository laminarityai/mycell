// Steps and their attempts. A run's step runs once through RunStep (Inngest's step.run in the
// job), and inside it the step's work is tried up to `attempts` times with backoff, so the
// attempts are counted on the step's record and a failure is recorded rather than thrown.
import type { RetryPolicy } from "../types";
import { describeFailure, type Failure } from "./failures";

/** 3 attempts, waiting 2 s then 8 s between them. */
export const defaultRetryPolicy: RetryPolicy = {
  attempts: 3,
  delayMs: (attempt) => 2000 * 4 ** (attempt - 1),
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
};

/** How many attempts it took, and when the last one began. */
type Tries = { attempts: number; lastAttemptAt: Date };

export type Attempted<T> =
  (Tries & { ok: true; value: T }) | (Tries & { ok: false; failure: Failure });

/**
 * Tries `work` until it succeeds, its failure isn't retryable, or the policy's attempts run
 * out. Never throws: the last failure comes back described, content-free.
 */
export async function withRetries<T>(
  policy: RetryPolicy,
  work: () => Promise<T>,
): Promise<Attempted<T>> {
  for (let attempt = 1; ; attempt++) {
    const tries = { attempts: attempt, lastAttemptAt: new Date() };
    try {
      return { ok: true, value: await work(), ...tries };
    } catch (error) {
      const failure = describeFailure(error);
      if (!failure.retryable || attempt >= policy.attempts) {
        return { ok: false, failure, ...tries };
      }
      await policy.sleep(policy.delayMs(attempt));
    }
  }
}
