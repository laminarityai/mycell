import "server-only";
import { z } from "zod";

// The only place that reads process.env. Everything else imports `env`.

/** A gateway model ID: `provider/model`, such as `typesafe-ai/jev-1.14.0`. */
export const modelIdSchema = z.string().regex(/^[\w.-]+\/[\w.:-]+$/, "Expected provider/model");

function positiveNumber(fallback: string) {
  return z.string().default(fallback).transform(Number).pipe(z.number().positive());
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  // Better Auth signs sessions with the secret and builds OAuth callback URLs from the URL.
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  // The Google OAuth client used for sign-in only (ADR-0002).
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  // Nango (connections): the environment API key authorises API and proxy calls; webhooks are
  // signed with the environment's separate webhook signing key.
  NANGO_API_KEY: z.string().min(1),
  NANGO_WEBHOOK_SIGNING_KEY: z.string().min(1),
  // Where Nango's API is. Only the e2e tests set it, to the fake Nango Playwright starts.
  NANGO_API_URL: z.url().default("https://api.nango.dev"),
  // Inngest (background jobs). INNGEST_DEV=1 points the client at the local Inngest dev server
  // (`npx inngest-cli@latest dev`), which needs no keys. Otherwise Inngest Cloud sends with the
  // event key and signs its requests to /api/inngest with the signing key.
  INNGEST_DEV: z
    .enum(["0", "1"])
    .optional()
    .transform((value) => value === "1"),
  INNGEST_EVENT_KEY: z.string().min(1).optional(),
  INNGEST_SIGNING_KEY: z.string().min(1).optional(),
  // The app key Inngest's encryption middleware encrypts step state and function results with,
  // so what Inngest stores of a run is ciphertext (ADR-0021). One key for the whole app, held in
  // a KMS in production and set here from it. Required unless INNGEST_DEV=1; without it the dev
  // server keeps step state in the clear.
  INNGEST_ENCRYPTION_KEY: z.string().min(32).optional(),
  // The Vercel AI Gateway: every model call goes through it, and it reports each call's cost.
  AI_GATEWAY_API_KEY: z.string().min(1),
  // Where the gateway is, when not Vercel's own (https://ai-gateway.vercel.sh/v4/ai). Only the
  // e2e tests set it, to the fake gateway Playwright starts.
  AI_GATEWAY_BASE_URL: z.url().optional(),
  // The global default model for each model role (invariant 6), as a gateway `provider/model` ID.
  // An org's own row in model_roles wins over these. Pin Jev's version for classify, since
  // experimental_decide may change in patch releases.
  MODEL_CLASSIFY: modelIdSchema,
  MODEL_FAST: modelIdSchema,
  MODEL_SMART: modelIdSchema,
  MODEL_JUDGE: modelIdSchema,
  // The embed role has a default, so existing .env files keep working. Its vectors have 1536
  // dimensions, and stored vectors must keep one size: change it only together with them.
  MODEL_EMBED: modelIdSchema.default("openai/text-embedding-3-small"),
  // The decision models: a classify model whose ID starts with one of these `provider/model`
  // prefixes is asked through experimental_decide, any other through a structured output on
  // `fast`. Comma-separated; Jev, and Laya, which an org may try through its role table.
  MODEL_DECISION_PREFIXES: z
    .string()
    .default("typesafe-ai/jev,convaiinnovations/laya")
    .transform((value) =>
      value
        .split(",")
        .map((prefix) => prefix.trim())
        .filter((prefix) => prefix !== ""),
    )
    .pipe(z.array(modelIdSchema)),
  // Credits (ADR-0010): how many credits one US dollar of gateway cost uses up, and the per-role
  // estimate a call must find in the balance before it is made. Placeholders until M7's pricing.
  CREDITS_PER_USD: positiveNumber("1000"),
  CREDIT_ESTIMATE_CLASSIFY: positiveNumber("1"),
  CREDIT_ESTIMATE_FAST: positiveNumber("5"),
  CREDIT_ESTIMATE_SMART: positiveNumber("50"),
  CREDIT_ESTIMATE_JUDGE: positiveNumber("50"),
  CREDIT_ESTIMATE_EMBED: positiveNumber("1"),
  // Each role's context window, in tokens: the most its default model reads at once. The builder
  // chat summarizes a conversation's history past half the `smart` window. An org that points a
  // role at another model keeps the role's figure, so set it for the smallest window in use.
  CONTEXT_WINDOW_CLASSIFY: positiveNumber("32000"),
  CONTEXT_WINDOW_FAST: positiveNumber("400000"),
  CONTEXT_WINDOW_SMART: positiveNumber("200000"),
  CONTEXT_WINDOW_JUDGE: positiveNumber("200000"),
  CONTEXT_WINDOW_EMBED: positiveNumber("8192"),
  // The injection screen (Google Cloud Model Armor): content fetched for a model is screened for
  // prompt injection before any model reads it. Unset, nothing is screened and memory learns
  // nothing, so CI and local dev start without Google Cloud. The template is its full resource
  // name; its prompt-injection filter must be on and its logging off (docs/architecture.md).
  MODEL_ARMOR_TEMPLATE: z
    .string()
    .regex(
      /^projects\/[^/]+\/locations\/[a-z0-9-]+\/templates\/[^/]+$/,
      "Expected projects/<project>/locations/<location>/templates/<template>",
    )
    .optional(),
  // How Mycel reaches Model Armor from Vercel with no stored key (Workload Identity Federation):
  // the pool provider that trusts the Vercel project's OIDC tokens, and the service account it
  // acts as. Both are required with MODEL_ARMOR_TEMPLATE.
  GCP_WORKLOAD_IDENTITY_PROVIDER: z
    .string()
    .regex(
      /^projects\/\d+\/locations\/global\/workloadIdentityPools\/[^/]+\/providers\/[^/]+$/,
      "Expected projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<id>",
    )
    .optional(),
  GCP_SERVICE_ACCOUNT_EMAIL: z.email().optional(),
  // Gmail push (ADR-0026): Gmail's watches publish to this Pub/Sub topic, and its push
  // subscription posts each notification to /api/google/gmail-push with a token Google signs
  // for the audience (the route's URL) as the push service account. All three or none: unset,
  // no watch starts, the route answers 404, and every app is polled every minute.
  GMAIL_PUSH_TOPIC: z
    .string()
    .regex(/^projects\/[^/]+\/topics\/[^/]+$/, "Expected projects/<project>/topics/<topic>")
    .optional(),
  GOOGLE_PUSH_AUDIENCE: z.url().optional(),
  GOOGLE_PUSH_SERVICE_ACCOUNT: z.email().optional(),
  // Drive push (ADR-0026): each Drive's changes.watch channel posts to BETTER_AUTH_URL's
  // /api/google/drive-push with a token naming the org and connection, signed with this secret
  // (HMAC-SHA256). Unset, no channel opens, the route answers 404, and Drive is polled every
  // minute.
  DRIVE_PUSH_SECRET: z.string().min(32).optional(),
  // The key store (ADR-0020, ADR-0024): AWS KMS holds two keys per org, made on first use under
  // the aliases `alias/<KMS_ALIAS_PREFIX>/org/<org ID>` (encryption) and `…/<org ID>/hash` (keyed
  // hashes). The key store needs KMS_REGION, which is required unless INNGEST_DEV=1, like the
  // Inngest keys. The access key pair is an IAM user's; leave both unset to use the AWS SDK's own
  // credential chain (a role) instead. Vercel reserves AWS_REGION and the AWS_* key names, hence
  // the KMS_ prefix. KMS_ENDPOINT points at a KMS other than AWS's regional one, such as
  // LocalStack.
  KMS_REGION: z.string().min(1).optional(),
  KMS_ACCESS_KEY_ID: z.string().min(1).optional(),
  KMS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  KMS_ALIAS_PREFIX: z
    .string()
    .regex(/^[\w-]+$/, "Letters, digits, - and _ only")
    .default("mycel"),
  KMS_ENDPOINT: z.url().optional(),
});

/**
 * Away from the local Inngest dev server (production, and CI's build and the e2e tests, which
 * run as production does), what production needs is required at boot rather than found missing
 * when a job or a held send first uses it.
 */
const REQUIRED_UNLESS_DEV = [
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
  "INNGEST_ENCRYPTION_KEY",
  "KMS_REGION",
] as const;

const checkedEnvSchema = envSchema.superRefine((parsed, context) => {
  if (parsed.MODEL_ARMOR_TEMPLATE !== undefined) {
    for (const key of ["GCP_WORKLOAD_IDENTITY_PROVIDER", "GCP_SERVICE_ACCOUNT_EMAIL"] as const) {
      if (parsed[key] === undefined) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: "Required with MODEL_ARMOR_TEMPLATE",
        });
      }
    }
  }
  const pushKeys = [
    "GMAIL_PUSH_TOPIC",
    "GOOGLE_PUSH_AUDIENCE",
    "GOOGLE_PUSH_SERVICE_ACCOUNT",
  ] as const;
  const pushUnset = pushKeys.filter((key) => parsed[key] === undefined);
  if (pushUnset.length > 0 && pushUnset.length < pushKeys.length) {
    for (const key of pushUnset) {
      context.addIssue({
        code: "custom",
        path: [key],
        message: "Required with the other Gmail push settings, or leave all three unset",
      });
    }
  }
  if ((parsed.KMS_ACCESS_KEY_ID === undefined) !== (parsed.KMS_SECRET_ACCESS_KEY === undefined)) {
    context.addIssue({
      code: "custom",
      path: ["KMS_SECRET_ACCESS_KEY"],
      message: "KMS_ACCESS_KEY_ID and KMS_SECRET_ACCESS_KEY are set together or not at all",
    });
  }
  if (parsed.INNGEST_DEV) return;
  for (const key of REQUIRED_UNLESS_DEV) {
    if (parsed[key] === undefined) {
      context.addIssue({ code: "custom", path: [key], message: "Required unless INNGEST_DEV=1" });
    }
  }
});

export type Env = z.output<typeof checkedEnvSchema>;

/** The environment `source` describes, checked; throws with every issue. */
export function parseEnv(source: Readonly<Record<string, string | undefined>>): Env {
  return checkedEnvSchema.parse(source);
}

export const env = parseEnv(process.env);
