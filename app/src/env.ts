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
});

export const env = envSchema
  .superRefine((parsed, context) => {
    if (parsed.INNGEST_DEV) return;
    for (const key of ["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"] as const) {
      if (parsed[key] === undefined) {
        context.addIssue({ code: "custom", path: [key], message: "Required unless INNGEST_DEV=1" });
      }
    }
  })
  .parse(process.env);
