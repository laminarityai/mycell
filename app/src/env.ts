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
  // Credits (ADR-0010): how many credits one US dollar of gateway cost uses up, and the per-role
  // estimate a call must find in the balance before it is made. Placeholders until M7's pricing.
  CREDITS_PER_USD: positiveNumber("1000"),
  CREDIT_ESTIMATE_CLASSIFY: positiveNumber("1"),
  CREDIT_ESTIMATE_FAST: positiveNumber("5"),
  CREDIT_ESTIMATE_SMART: positiveNumber("50"),
  CREDIT_ESTIMATE_JUDGE: positiveNumber("50"),
  // The key store (ADR-0020, ADR-0024): AWS KMS holds one key per org, made on first use under
  // the alias `alias/<KMS_ALIAS_PREFIX>/org/<org ID>`. The key store needs KMS_REGION; without
  // it, encrypting or decrypting fails. The access key pair is an IAM user's; leave both unset to
  // use the AWS SDK's own credential chain (a role) instead. Vercel reserves AWS_REGION and the
  // AWS_* key names, hence the KMS_ prefix. KMS_ENDPOINT points at a KMS other than AWS's
  // regional one, such as LocalStack.
  KMS_REGION: z.string().min(1).optional(),
  KMS_ACCESS_KEY_ID: z.string().min(1).optional(),
  KMS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  KMS_ALIAS_PREFIX: z
    .string()
    .regex(/^[\w-]+$/, "Letters, digits, - and _ only")
    .default("mycel"),
  KMS_ENDPOINT: z.url().optional(),
});

export const env = envSchema
  .superRefine((parsed, context) => {
    if (parsed.INNGEST_DEV) return;
    for (const key of ["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"] as const) {
      if (parsed[key] === undefined) {
        context.addIssue({ code: "custom", path: [key], message: "Required unless INNGEST_DEV=1" });
      }
    }
    if ((parsed.KMS_ACCESS_KEY_ID === undefined) !== (parsed.KMS_SECRET_ACCESS_KEY === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["KMS_SECRET_ACCESS_KEY"],
        message: "KMS_ACCESS_KEY_ID and KMS_SECRET_ACCESS_KEY are set together or not at all",
      });
    }
  })
  .parse(process.env);
