// The key store (ADR-0020, ADR-0024): encrypts and decrypts text for one org with that org's
// own key, held in a KMS and made on first use. What it returns is safe to store; the key
// material it uses is never stored or logged. Held sends use it.
import type { Ctx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import { open, parseEnvelope, seal } from "./lib/envelope";
import { decryptDataKey, destroyKey, generateDataKey } from "./lib/kms";

/** Encrypts `text` with the ctx org's key. Only `decryptForOrg` in the same org opens it. */
export async function encryptForOrg(ctx: Ctx, text: string): Promise<string> {
  const dataKey = await generateDataKey(ctx.orgId);
  try {
    return seal(ctx.orgId, dataKey, text);
  } finally {
    dataKey.plaintext.fill(0);
  }
}

/** The text `encryptForOrg` encrypted for the ctx org. */
export async function decryptForOrg(ctx: Ctx, encrypted: string): Promise<string> {
  const envelope = parseEnvelope(encrypted);
  const dataKey = await decryptDataKey(ctx.orgId, envelope.encryptedKey);
  try {
    return open(ctx.orgId, dataKey, envelope);
  } finally {
    dataKey.fill(0);
  }
}

/**
 * Destroys the ctx org's key, for a company leaving Mycel: everything encrypted for it becomes
 * unreadable at once, and KMS deletes the key after its 7-day waiting period. Encrypting again
 * makes a new key, which doesn't open what the old one encrypted. Admins and scheduled jobs
 * only.
 */
export async function destroyOrgKey(ctx: Ctx): Promise<void> {
  if (ctx.role === "member") throw new ForbiddenError();
  await destroyKey(ctx.orgId);
}
