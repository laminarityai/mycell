// Push's settings per environment (ADR-0026). Each app's push is optional: without its settings
// (local dev, a test's own choice) no watch starts for it, its route answers 404, and the app is
// polled every minute.
import { env } from "@/env";

/** Where Drive push's route is, under the app's public URL. */
export const DRIVE_PUSH_PATH = "/api/google/drive-push";

/** Gmail push's settings, all three set in the env. */
export type GmailPushConfig = { topic: string; audience: string; serviceAccount: string };

/** Gmail push's settings, or null in an environment without them. */
export function gmailPushConfig(): GmailPushConfig | null {
  const topic = env.GMAIL_PUSH_TOPIC;
  const audience = env.GOOGLE_PUSH_AUDIENCE;
  const serviceAccount = env.GOOGLE_PUSH_SERVICE_ACCOUNT;
  if (topic === undefined || audience === undefined || serviceAccount === undefined) return null;
  return { topic, audience, serviceAccount };
}

/**
 * Drive push's settings: where its channels post (the app's public URL plus the route's path)
 * and the secret their tokens are signed with. Null without DRIVE_PUSH_SECRET.
 */
export type DrivePushConfig = { address: string; secret: string };

export function drivePushConfig(): DrivePushConfig | null {
  const secret = env.DRIVE_PUSH_SECRET;
  if (secret === undefined) return null;
  return { address: new URL(DRIVE_PUSH_PATH, env.BETTER_AUTH_URL).toString(), secret };
}
