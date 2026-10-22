// Envelope encryption: the text is encrypted with AES-256-GCM under a fresh data key, and the
// envelope carries that data key only in the encrypted form KMS gave it. The org's ID is the
// additional authenticated data, so an envelope opens only for its own org.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";

const VERSION = "v1";
const IV_BYTES = 12;
const ALGORITHM = "aes-256-gcm";

const base64url = z.string().regex(/^[\w-]+$/);

/** An envelope as stored: `v1.<encrypted data key>.<iv>.<auth tag>.<ciphertext>`, base64url. */
const envelopeSchema = z
  .string()
  .transform((value) => value.split("."))
  .pipe(z.tuple([z.literal(VERSION), base64url, base64url, base64url, base64url.or(z.literal(""))]))
  .transform(([, encryptedKey, iv, tag, ciphertext]) => ({
    encryptedKey: Buffer.from(encryptedKey, "base64url"),
    iv: Buffer.from(iv, "base64url"),
    tag: Buffer.from(tag, "base64url"),
    ciphertext: Buffer.from(ciphertext, "base64url"),
  }));

export type Envelope = z.output<typeof envelopeSchema>;

export function seal(
  orgId: string,
  dataKey: { plaintext: Uint8Array; encrypted: Uint8Array },
  text: string,
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, dataKey.plaintext, iv).setAAD(Buffer.from(orgId));
  const ciphertext = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [
    VERSION,
    Buffer.from(dataKey.encrypted).toString("base64url"),
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/** Parses a stored envelope; anything else is refused. */
export function parseEnvelope(value: string): Envelope {
  return envelopeSchema.parse(value);
}

export function open(orgId: string, dataKey: Uint8Array, envelope: Envelope): string {
  const decipher = createDecipheriv(ALGORITHM, dataKey, envelope.iv)
    .setAAD(Buffer.from(orgId))
    .setAuthTag(envelope.tag);
  return Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]).toString("utf8");
}
