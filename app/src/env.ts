import { z } from "zod";

// The only place that reads process.env. Everything else imports `env`.
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
});

export const env = envSchema.parse(process.env);
