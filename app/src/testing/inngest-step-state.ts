// What Inngest stores of a run's step state: each step's output as the client's encryption
// middleware hands it over (ADR-0021), and decrypting it again with a key, as the middleware
// does when Inngest replays a step. Tests never reach Inngest, so they run the middleware's
// step hooks directly.
import { encryptionMiddleware } from "@inngest/middleware-encryption";
import type { Middleware } from "inngest";
import { inngest, stepStateEncryption } from "@/lib/inngest";

/** The step hooks' arguments: the encryption middleware reads only `next`. */
const hookArgs = (value: unknown) => ({ next: () => Promise.resolve(value) }) as never;

function instance(middleware: Middleware.Class): Middleware.BaseMiddleware {
  return new middleware({ client: inngest });
}

/** A step's output as the client sends it to Inngest: ciphertext under the app key. */
export async function storedStepOutput(output: unknown): Promise<unknown> {
  if (stepStateEncryption === undefined) return output;
  const middleware = instance(stepStateEncryption);
  if (middleware.wrapStepHandler === undefined) throw new Error("no step handler hook");
  return middleware.wrapStepHandler(hookArgs(output));
}

/**
 * Decrypts a step-state recorder's entries (`{ id, result }`, or `{ id, thrown }`, which the
 * middleware leaves as it is) with `key`, as Inngest's replay would. Rejects for another key.
 */
export async function decryptStepState(state: readonly string[], key: string): Promise<unknown[]> {
  const middleware = instance(encryptionMiddleware({ key }));
  if (middleware.wrapStep === undefined) throw new Error("no step hook");
  const decrypt = middleware.wrapStep.bind(middleware);
  return Promise.all(
    state.map(async (entry) => {
      const parsed = JSON.parse(entry) as { id: string; result?: unknown };
      if (!("result" in parsed)) return parsed;
      return { ...parsed, result: await decrypt(hookArgs(parsed.result)) };
    }),
  );
}
