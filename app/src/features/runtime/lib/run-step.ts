// Steps and their attempts. Each attempt at a run's step is a step of its own (Inngest's
// step.run in the job), and the backoff between two attempts is a wait between them (step.sleep),
// so no request stays open while a step waits and a replay neither repeats a finished attempt nor
// waits again. The attempt that ends the step records it, with how many attempts it took, so a
// failure is recorded rather than thrown.
import type { Json, RunSleep, RunStep } from "@/lib/inngest";
import { describeFailure, type Failure } from "./failures";
import { now } from "@/lib/time";

/** How often a failing step is tried: 3 attempts. */
export const ATTEMPTS = 3;

/** How long a step waits before attempt `attempt + 1`: 2 s, then 8 s. */
export const retryDelayMs = (attempt: number): number => 2000 * 4 ** (attempt - 1);

/** How many attempts it took, and when the last one began. */
type Tries = { attempts: number; lastAttemptAt: Date };

export type Attempted<T> =
  (Tries & { ok: true; value: T }) | (Tries & { ok: false; failure: Failure });

/**
 * What an attempt that failed but may be tried again hands on: when the step's first attempt
 * began, for its record. Nothing of the failure, which the last attempt describes.
 */
export type Retry = { retry: { startedAt: string } };

/** Where an attempt is: its number, and when the step's first attempt began. */
export type AttemptAt = { attempt: number; startedAt: Date };

/**
 * Tries `work` once, as attempt `attempt`. Never throws: a failure comes back described,
 * content-free, or as `retry` when it's retryable and attempts remain.
 */
export async function tryOnce<T>(
  attempt: number,
  work: () => Promise<T>,
): Promise<Attempted<T> | "retry"> {
  const tries = { attempts: attempt, lastAttemptAt: now() };
  try {
    return { ok: true, value: await work(), ...tries };
  } catch (error) {
    const failure = describeFailure(error);
    if (failure.retryable && attempt < ATTEMPTS) return "retry";
    return { ok: false, failure, ...tries };
  }
}

/**
 * Runs step `id`'s attempts until one ends it: the first under `id` itself, each later one under
 * `<id>:attempt-<n>`, after a wait of `retryDelayMs` under `<id>:wait-<n>`. A spec step's ID
 * holds no colon, so these never meet another step's.
 */
export async function runAttempts<T extends Json>(
  id: string,
  runStep: RunStep,
  sleep: RunSleep,
  attempt: (at: AttemptAt) => Promise<T | Retry>,
): Promise<T> {
  let startedAt: Date | undefined;
  for (let n = 1; ; n++) {
    const stepId = n === 1 ? id : `${id}:attempt-${String(n)}`;
    const at = { attempt: n, startedAt: startedAt ?? now() };
    const result = await runStep<T | Retry>(stepId, () => attempt(at));
    if (!isRetry(result)) return result;
    startedAt = new Date(result.retry.startedAt);
    await sleep(`${id}:wait-${String(n)}`, retryDelayMs(n));
  }
}

function isRetry(result: Json): result is Retry {
  return typeof result === "object" && result !== null && "retry" in result;
}
