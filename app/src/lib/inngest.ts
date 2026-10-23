// The one Inngest client, and how a job's work runs in steps. Features define their functions in
// their jobs.ts, and the one Inngest route (src/app/api/inngest/route.ts) serves them all.
import { encryptionMiddleware } from "@inngest/middleware-encryption";
import { Inngest } from "inngest";
import { isForeignKeyViolation } from "@/db/errors";
import { env } from "@/env";
import { NotFoundError } from "./errors";

/**
 * Inngest's encryption middleware under the app key (ADR-0021): every step's output and every
 * function's result is encrypted before it leaves for Inngest, and decrypted when Inngest hands
 * it back, so what Inngest stores of a run, content a step passes to later steps included, is
 * ciphertext. Undefined only against the local dev server without a key.
 */
export const stepStateEncryption =
  env.INNGEST_ENCRYPTION_KEY === undefined
    ? undefined
    : encryptionMiddleware({ key: env.INNGEST_ENCRYPTION_KEY });

export const inngest = new Inngest({
  id: "mycel",
  isDev: env.INNGEST_DEV,
  eventKey: env.INNGEST_EVENT_KEY,
  signingKey: env.INNGEST_SIGNING_KEY,
  middleware: stepStateEncryption === undefined ? [] : [stepStateEncryption],
});

/**
 * At most this many of a job's runs execute at once for one org (its per-org concurrency
 * key), so one org's large mailboxes or busy workflows leave other orgs' work unblocked.
 */
export const PER_ORG_LIMIT = 3;

/** JSON: what a step returns, since Inngest stores it and replays it instead of re-running. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * Runs one named step: Inngest's `step.run` in a job, called straight through elsewhere. A
 * finished step's result is replayed, never re-run, so a retry repeats no earlier step.
 */
export type RunStep = <T extends Json>(id: string, run: () => Promise<T>) => Promise<T>;

/** Runs each step straight through: how a job's work runs outside Inngest (tests, scripts). */
export const runInline: RunStep = (_id, run) => run();

/** A job's `step.run` as a RunStep. */
export function stepRunner(step: {
  run: (id: string, run: () => Promise<unknown>) => Promise<unknown>;
}): RunStep {
  // Step results are plain JSON already, so Inngest's serialized type is the same type.
  return <T extends Json>(id: string, run: () => Promise<T>) => step.run(id, run) as Promise<T>;
}

/**
 * Runs `work`, returning `gone` instead of throwing when the connection it works for is gone:
 * a missing connection (or app on it) is NotFoundError, and a write for a deleted one breaks
 * one of `foreignKeys`, the caller's foreign keys to it. The job then ends quietly.
 */
export async function untilGone<T, G>(
  foreignKeys: readonly string[],
  work: () => Promise<T>,
  gone: G,
): Promise<T | G> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof NotFoundError) return gone;
    if (foreignKeys.some((name) => isForeignKeyViolation(error, name))) return gone;
    throw error;
  }
}
