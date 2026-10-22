// The fake KMS: the AWS KMS JSON API behind msw's request interception, in memory, so the key
// store runs the real AWS SDK without network or an AWS account. It answers only the operations
// the key store makes, in the shapes AWS documents, with AWS's error types; anything else fails
// the test. Data keys are random, and their "ciphertext" is a handle the fake looks up, bound to
// its key and encryption context as KMS binds them.
import { randomBytes, randomUUID } from "node:crypto";
import { http, HttpResponse } from "msw";
import { z } from "zod";
import { env } from "@/env";

type KeyState = "Enabled" | "PendingDeletion";
type FakeKey = { keyId: string; arn: string; state: KeyState };
type DataKey = { keyId: string; context: Record<string, string>; plaintext: Buffer };

const ACCOUNT = "111122223333";
const KMS_URL = /^https:\/\/kms\.[a-z0-9-]+\.amazonaws\.com\/$/;

const contextSchema = z.record(z.string(), z.string()).default({});
const requestSchemas = {
  CreateKey: z.object({ Description: z.string().optional(), KeySpec: z.string().optional() }),
  CreateAlias: z.object({ AliasName: z.string(), TargetKeyId: z.string() }),
  DeleteAlias: z.object({ AliasName: z.string() }),
  DescribeKey: z.object({ KeyId: z.string() }),
  GenerateDataKey: z.object({
    KeyId: z.string(),
    KeySpec: z.literal("AES_256"),
    EncryptionContext: contextSchema,
  }),
  Decrypt: z.object({
    CiphertextBlob: z.string(),
    KeyId: z.string().optional(),
    EncryptionContext: contextSchema,
  }),
  ScheduleKeyDeletion: z.object({
    KeyId: z.string(),
    PendingWindowInDays: z.number().int().min(7).max(30).optional(),
  }),
};
type Operation = keyof typeof requestSchemas;

class KmsError extends Error {
  constructor(
    readonly type: string,
    message: string,
  ) {
    super(message);
  }
}

class FakeKms {
  private keys = new Map<string, FakeKey>();
  private aliases = new Map<string, string>();
  private dataKeys = new Map<string, DataKey>();
  private calls: Operation[] = [];

  reset(): void {
    this.keys = new Map();
    this.aliases = new Map();
    this.dataKeys = new Map();
    this.calls = [];
  }

  /** The operations called so far, oldest first. */
  operations(): Operation[] {
    return [...this.calls];
  }

  /** Every key, with the aliases naming it, oldest first. */
  listKeys(): { keyId: string; state: KeyState; aliases: string[] }[] {
    return [...this.keys.values()].map(({ keyId, state }) => ({
      keyId,
      state,
      aliases: [...this.aliases].filter(([, id]) => id === keyId).map(([alias]) => alias),
    }));
  }

  /** The key behind each data key handed out, in the order they were made. */
  dataKeyOwners(): string[] {
    return [...this.dataKeys.values()].map(({ keyId }) => keyId);
  }

  /** Every plaintext data key handed out, base64 and hex, to scan tables and logs for. */
  keyMaterial(): string[] {
    return [...this.dataKeys.values()].flatMap(({ plaintext }) => [
      plaintext.toString("base64"),
      plaintext.toString("hex"),
    ]);
  }

  readonly handlers = [
    http.post(KMS_URL, async ({ request }) => {
      const signed = request.headers.get("authorization") ?? "";
      if (!signed.startsWith(`AWS4-HMAC-SHA256 Credential=${env.KMS_ACCESS_KEY_ID ?? ""}/`)) {
        return error(new KmsError("UnrecognizedClientException", "The security token is invalid."));
      }
      const target = request.headers.get("x-amz-target") ?? "";
      const operation = target.replace(/^TrentService\./, "");
      if (!(operation in requestSchemas)) {
        throw new Error(`The fake KMS doesn't handle ${target}`);
      }
      const op = operation as Operation;
      this.calls.push(op);
      try {
        const body: unknown = await request.json();
        return HttpResponse.json(this.answer(op, body), {
          headers: { "content-type": "application/x-amz-json-1.1" },
        });
      } catch (thrown) {
        if (thrown instanceof KmsError) return error(thrown);
        throw thrown;
      }
    }),
  ];

  private answer(op: Operation, body: unknown): object {
    switch (op) {
      case "CreateKey": {
        requestSchemas.CreateKey.parse(body);
        const keyId = randomUUID();
        const key: FakeKey = { keyId, arn: arnOf(keyId), state: "Enabled" };
        this.keys.set(keyId, key);
        return { KeyMetadata: metadata(key) };
      }
      case "CreateAlias": {
        const { AliasName, TargetKeyId } = requestSchemas.CreateAlias.parse(body);
        if (this.aliases.has(AliasName)) {
          throw new KmsError("AlreadyExistsException", `Alias ${AliasName} already exists.`);
        }
        this.aliases.set(AliasName, this.find(TargetKeyId).keyId);
        return {};
      }
      case "DeleteAlias": {
        const { AliasName } = requestSchemas.DeleteAlias.parse(body);
        if (!this.aliases.delete(AliasName)) {
          throw new KmsError("NotFoundException", `Alias ${AliasName} is not found.`);
        }
        return {};
      }
      case "DescribeKey": {
        const { KeyId } = requestSchemas.DescribeKey.parse(body);
        return { KeyMetadata: metadata(this.find(KeyId)) };
      }
      case "GenerateDataKey": {
        const request = requestSchemas.GenerateDataKey.parse(body);
        const key = this.usable(request.KeyId);
        const handle = randomBytes(48).toString("base64");
        const plaintext = randomBytes(32);
        this.dataKeys.set(handle, {
          keyId: key.keyId,
          context: request.EncryptionContext,
          plaintext,
        });
        return {
          KeyId: key.arn,
          CiphertextBlob: handle,
          Plaintext: plaintext.toString("base64"),
        };
      }
      case "Decrypt": {
        const request = requestSchemas.Decrypt.parse(body);
        const dataKey = this.dataKeys.get(request.CiphertextBlob);
        if (dataKey === undefined || !sameContext(dataKey.context, request.EncryptionContext)) {
          throw new KmsError("InvalidCiphertextException", "");
        }
        if (request.KeyId !== undefined && this.find(request.KeyId).keyId !== dataKey.keyId) {
          throw new KmsError("IncorrectKeyException", "The key ID doesn't match the ciphertext.");
        }
        const key = this.usable(dataKey.keyId);
        return {
          KeyId: key.arn,
          Plaintext: dataKey.plaintext.toString("base64"),
          EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
        };
      }
      case "ScheduleKeyDeletion": {
        const { KeyId, PendingWindowInDays = 30 } = requestSchemas.ScheduleKeyDeletion.parse(body);
        const key = this.find(KeyId);
        if (key.state === "PendingDeletion") {
          throw new KmsError("KMSInvalidStateException", `${key.arn} is pending deletion.`);
        }
        key.state = "PendingDeletion";
        const deletionDate = Date.now() / 1000 + PendingWindowInDays * 86_400;
        return {
          KeyId: key.arn,
          KeyState: key.state,
          DeletionDate: deletionDate,
          PendingWindowInDays,
        };
      }
    }
  }

  /** A key by ID, ARN, alias name or alias ARN, as KMS resolves a `KeyId`. */
  private find(id: string): FakeKey {
    const aliasName = id.replace(/^arn:aws:kms:[^:]+:\d+:/, "");
    const keyId = aliasName.startsWith("alias/")
      ? this.aliases.get(aliasName)
      : aliasName.replace(/^key\//, "");
    const key = keyId === undefined ? undefined : this.keys.get(keyId);
    if (key === undefined) throw new KmsError("NotFoundException", `${id} is not found.`);
    return key;
  }

  private usable(id: string): FakeKey {
    const key = this.find(id);
    if (key.state !== "Enabled") {
      throw new KmsError("KMSInvalidStateException", `${key.arn} is pending deletion.`);
    }
    return key;
  }
}

function arnOf(keyId: string): string {
  return `arn:aws:kms:${env.KMS_REGION ?? "us-east-1"}:${ACCOUNT}:key/${keyId}`;
}

function metadata(key: FakeKey): object {
  return {
    KeyId: key.keyId,
    Arn: key.arn,
    AWSAccountId: ACCOUNT,
    Enabled: key.state === "Enabled",
    KeyState: key.state,
    KeyUsage: "ENCRYPT_DECRYPT",
    KeySpec: "SYMMETRIC_DEFAULT",
  };
}

function sameContext(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

function error({ type, message }: KmsError): Response {
  return HttpResponse.json(
    { __type: type, message },
    {
      status: 400,
      headers: { "content-type": "application/x-amz-json-1.1", "x-amzn-errortype": type },
    },
  );
}

export const fakeKms = new FakeKms();
