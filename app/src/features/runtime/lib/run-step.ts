// Steps and their attempts. A run's step runs once through RunStep (Inngest's step.run in the
// job), and inside it the step's work is tried up to `attempts` times with backoff, so the
// attempts are counted on the step's record and a failure is recorded rather than thrown.
import type { RetryPolicy, RunStep } from "../types";
import { describeFailure, type Failure } from "./failures";

export const runInline: RunStep = (_id, run) => run();

/** 3 attempts, waiting 2 s then 8 s between them. */
export const defaultRetryPolicy: RetryPolicy = {
  attempts: 3,
  delayMs: (attempt) => 2000 * 4 ** (attempt - 1),
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
};

export type Attempted<T> =
  { ok: true; value: T; attempts: number } | { ok: false; failure: Failure; attempts: number };

/**
 * Tries `work` until it succeeds, its failure isn't retryable, or the policy's attempts run
 * out. Never throws: the last failure comes back described, content-free.
 */
export async function withRetries<T>(
  policy: RetryPolicy,
  work: () => Promise<T>,
): Promise<Attempted<T>> {
  for (let attempt = 1; ; attempt++) {
    try {
      return { ok: true, value: await work(), attempts: attempt };
    } catch (error) {
      const failure = describeFailure(error);
      if (!failure.retryable || attempt >= policy.attempts) {
        return { ok: false, failure, attempts: attempt };
      }
      await policy.sleep(policy.delayMs(attempt));
    }
  }
}
