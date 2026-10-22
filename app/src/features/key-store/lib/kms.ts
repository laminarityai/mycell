// The org keys in AWS KMS. Each org has one symmetric key, found by its alias and made on first
// use. Its plaintext never leaves KMS: the key store asks KMS for a fresh data key per
// encryption and stores only that data key's encrypted form, which only the org's key opens.
// Every data key is bound to its org by the encryption context, so KMS refuses to open one
// under another org's name even if its ciphertext were copied across. Each org also has an HMAC
// key, made the same way under its own alias, that KMS computes keyed hashes with: its material
// never leaves KMS either.
import {
  AlreadyExistsException,
  CreateAliasCommand,
  CreateKeyCommand,
  DecryptCommand,
  DeleteAliasCommand,
  DescribeKeyCommand,
  GenerateDataKeyCommand,
  GenerateMacCommand,
  IncorrectKeyException,
  InvalidCiphertextException,
  KMSClient,
  KMSInvalidStateException,
  NotFoundException,
  ScheduleKeyDeletionCommand,
} from "@aws-sdk/client-kms";
import { env } from "@/env";
import { NotFoundError } from "@/lib/errors";

/** A data key: its plaintext, for this one use only, and its encrypted form, to store. */
export type DataKey = { plaintext: Uint8Array; encrypted: Uint8Array };

/** How long AWS KMS waits before deleting a key scheduled for deletion: its minimum. */
const DELETION_WINDOW_DAYS = 7;

let client: KMSClient | undefined;

function kms(): KMSClient {
  if (env.KMS_REGION === undefined) {
    throw new Error("The key store needs KMS_REGION (see app/.env.example).");
  }
  client ??= new KMSClient({
    region: env.KMS_REGION,
    endpoint: env.KMS_ENDPOINT,
    credentials:
      env.KMS_ACCESS_KEY_ID === undefined || env.KMS_SECRET_ACCESS_KEY === undefined
        ? undefined
        : {
            accessKeyId: env.KMS_ACCESS_KEY_ID,
            secretAccessKey: env.KMS_SECRET_ACCESS_KEY,
          },
  });
  return client;
}

// What each of an org's keys is for: encrypting data keys, or keyed hashes.
type KeyPurpose = "encrypt" | "hash";

const KEY_SPECS = {
  encrypt: { KeySpec: "SYMMETRIC_DEFAULT", KeyUsage: "ENCRYPT_DECRYPT" },
  hash: { KeySpec: "HMAC_256", KeyUsage: "GENERATE_VERIFY_MAC" },
} as const;

function aliasOf(orgId: string, purpose: KeyPurpose = "encrypt"): string {
  const alias = `alias/${env.KMS_ALIAS_PREFIX}/org/${orgId}`;
  return purpose === "encrypt" ? alias : `${alias}/${purpose}`;
}

function encryptionContext(orgId: string): Record<string, string> {
  return { orgId };
}

/** A new data key under the org's key, making the org's key first if it has none. */
export async function generateDataKey(orgId: string): Promise<DataKey> {
  return withOrgKey(orgId, "encrypt", () => generateUnder(orgId));
}

/**
 * The HMAC-SHA-256 of `message` under the org's hashing key, making that key first if it has
 * none: the same message gives the same MAC until the key is destroyed.
 */
export async function generateMac(orgId: string, message: Uint8Array): Promise<Uint8Array> {
  return withOrgKey(orgId, "hash", async () => {
    const { Mac } = await kms().send(
      new GenerateMacCommand({
        KeyId: aliasOf(orgId, "hash"),
        Message: message,
        MacAlgorithm: "HMAC_SHA_256",
      }),
    );
    if (Mac === undefined) throw new Error("KMS returned no MAC.");
    return Mac;
  });
}

// Runs `work` with the org's key for the purpose, making the key first when KMS has none.
async function withOrgKey<T>(orgId: string, purpose: KeyPurpose, work: () => Promise<T>) {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof NotFoundException)) throw error;
  }
  await createOrgKey(orgId, purpose);
  return work();
}

async function generateUnder(orgId: string): Promise<DataKey> {
  const { Plaintext, CiphertextBlob } = await kms().send(
    new GenerateDataKeyCommand({
      KeyId: aliasOf(orgId),
      KeySpec: "AES_256",
      EncryptionContext: encryptionContext(orgId),
    }),
  );
  if (Plaintext === undefined || CiphertextBlob === undefined) {
    throw new Error("KMS returned no data key.");
  }
  return { plaintext: Plaintext, encrypted: CiphertextBlob };
}

/**
 * Makes the org's key and names it with the org's alias. When another request made one at the
 * same moment, its alias wins and the key made here is scheduled for deletion unused.
 */
async function createOrgKey(orgId: string, purpose: KeyPurpose): Promise<void> {
  const { KeyMetadata } = await kms().send(
    new CreateKeyCommand({
      Description: `Mycel key store: org ${orgId}${purpose === "hash" ? ", keyed hashes" : ""}`,
      ...KEY_SPECS[purpose],
    }),
  );
  const keyId = KeyMetadata?.KeyId;
  if (keyId === undefined) throw new Error("KMS made a key with no ID.");
  try {
    await kms().send(
      new CreateAliasCommand({ AliasName: aliasOf(orgId, purpose), TargetKeyId: keyId }),
    );
  } catch (error) {
    if (!(error instanceof AlreadyExistsException)) throw error;
    await kms().send(
      new ScheduleKeyDeletionCommand({ KeyId: keyId, PendingWindowInDays: DELETION_WINDOW_DAYS }),
    );
  }
}

/**
 * A data key's plaintext, from its encrypted form, under the org's key only. A data key from
 * another org, or under a destroyed key, is NotFoundError: to this org it doesn't exist.
 */
export async function decryptDataKey(orgId: string, encrypted: Uint8Array): Promise<Uint8Array> {
  try {
    const { Plaintext } = await kms().send(
      new DecryptCommand({
        KeyId: aliasOf(orgId),
        CiphertextBlob: encrypted,
        EncryptionContext: encryptionContext(orgId),
      }),
    );
    if (Plaintext === undefined) throw new Error("KMS returned no plaintext.");
    return Plaintext;
  } catch (error) {
    if (unreadable(error)) throw new NotFoundError("encrypted item");
    throw error;
  }
}

/** KMS's refusals of a data key that isn't this org's, or whose key is gone or going. */
function unreadable(error: unknown): boolean {
  return (
    error instanceof InvalidCiphertextException ||
    error instanceof IncorrectKeyException ||
    error instanceof NotFoundException ||
    error instanceof KMSInvalidStateException
  );
}

/**
 * Destroys the org's keys, for encryption and for hashing: KMS refuses each at once and deletes
 * it after its waiting period, and its alias goes, so nothing finds it again. Does nothing for
 * a key the org never had.
 */
export async function destroyKeys(orgId: string): Promise<void> {
  await destroyKey(aliasOf(orgId, "encrypt"));
  await destroyKey(aliasOf(orgId, "hash"));
}

async function destroyKey(alias: string): Promise<void> {
  let keyId: string | undefined;
  try {
    const { KeyMetadata } = await kms().send(new DescribeKeyCommand({ KeyId: alias }));
    keyId = KeyMetadata?.KeyId;
  } catch (error) {
    if (error instanceof NotFoundException) return;
    throw error;
  }
  if (keyId === undefined) throw new Error("KMS described a key with no ID.");
  await kms().send(
    new ScheduleKeyDeletionCommand({ KeyId: keyId, PendingWindowInDays: DELETION_WINDOW_DAYS }),
  );
  await kms().send(new DeleteAliasCommand({ AliasName: alias }));
}
