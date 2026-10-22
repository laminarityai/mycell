// The one Inngest client. Features define their functions in their jobs.ts, and the one Inngest
// route (src/app/api/inngest/route.ts) serves them all.
import { encryptionMiddleware } from "@inngest/middleware-encryption";
import { Inngest } from "inngest";
import { env } from "@/env";

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
