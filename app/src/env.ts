import { z } from "zod";

// The only place that reads process.env. Everything else imports `env`.
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export const env = envSchema.parse(process.env);
