// The key store (ADR-0020, ADR-0024): encrypts and decrypts text for one org with that org's
// own key, held in a KMS and made on first use, and hashes text under another key of the org's
// (a keyed hash: the same text gives the same hash, which only that key can make). What it
// returns is safe to store; the key material it uses is never stored or logged. Held sends use
// the encryption, and memory's do-not-learn list the hash.
import type { Ctx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import { open, parseEnvelope, seal } from "./lib/envelope";
import { decryptDataKey, destroyKeys, generateDataKey, generateMac } from "./lib/kms";

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
 * A keyed hash of `text` under the ctx org's hashing key (HMAC-SHA-256, computed by the KMS),
 * base64url: the same text always gives the same hash in one org, and no other org's, so what's
 * stored can be checked against new text without holding the text. Callers normalize the text
 * first (an address lowercased, say).
 */
export async function hashForOrg(ctx: Ctx, text: string): Promise<string> {
  const mac = await generateMac(ctx.orgId, Buffer.from(text, "utf8"));
  return Buffer.from(mac).toString("base64url");
}

/**
 * Destroys the ctx org's keys, for a company leaving Mycel: everything encrypted for it becomes
 * unreadable at once, nothing hashes as before, and KMS deletes the keys after its 7-day
 * waiting period. Encrypting or hashing again makes a new key, which doesn't open what the old
 * one encrypted or match what it hashed. Admins and scheduled jobs only.
 */
export async function destroyOrgKey(ctx: Ctx): Promise<void> {
  if (ctx.role === "member") throw new ForbiddenError();
  await destroyKeys(ctx.orgId);
}
