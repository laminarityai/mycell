// Gmail push (ADR-0026). Gmail publishes a notification to our Pub/Sub topic when a watched
// mailbox changes, and the push subscription posts it to /api/google/gmail-push. A notification
// is a doorbell, never the delivery: it only starts the poll Mycel already has for each
// connection on that mailbox, which reads what's new from the app's stored cursor.
import { gmailPushConnectionIds } from "@/features/connections/server";
import { findOrgIdForAddress } from "@/features/orgs/server";
import { z } from "zod";
import { env } from "@/env";
import { systemCtx } from "@/lib/ctx";
import { inngest } from "@/lib/inngest";
import { connectionPollDue } from "./events";
import { isGooglePush } from "./google-push-token";

/** Gmail push's settings, all three set in the env. */
export type GmailPushConfig = { topic: string; audience: string; serviceAccount: string };

/**
 * Gmail push's settings, or null in an environment without them (local dev, the tests' own
 * choice): no watch starts there, and every app is polled every minute.
 */
export function gmailPushConfig(): GmailPushConfig | null {
  const topic = env.GMAIL_PUSH_TOPIC;
  const audience = env.GOOGLE_PUSH_AUDIENCE;
  const serviceAccount = env.GOOGLE_PUSH_SERVICE_ACCOUNT;
  if (topic === undefined || audience === undefined || serviceAccount === undefined) return null;
  return { topic, audience, serviceAccount };
}

// A Pub/Sub push request's body: one message, whose data is base64.
const pushBody = z.object({
  message: z.object({ data: z.base64(), messageId: z.string().optional() }),
  subscription: z.string(),
});

// What Gmail publishes. The history ID isn't used: the poll reads from the stored cursor.
const gmailNotification = z.object({
  emailAddress: z.email(),
  historyId: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]),
});

/**
 * Handles one push from Pub/Sub, given its raw body and headers. Without push configured it's
 * 404. A push whose token isn't Google's, for our audience, from our push service account, is
 * 401 and starts nothing. Every verified push is 204, a malformed one (logged) or one for an
 * address no org has included, so Pub/Sub doesn't deliver it again. It sends
 * `discovery/connection.poll-due` for each connection on that mailbox, in the org that owns it,
 * whose Gmail is active and which needs no reconnect.
 */
export async function handleGmailPush(
  rawBody: string,
  headers: Headers,
): Promise<{ status: 204 | 401 | 404 }> {
  const config = gmailPushConfig();
  if (config === null) return { status: 404 };
  if (!(await isGooglePush(headers.get("authorization"), config))) return { status: 401 };
  const address = parseNotification(rawBody);
  if (address === undefined) return { status: 204 };
  const orgId = await findOrgIdForAddress(address);
  if (orgId === undefined) return { status: 204 };
  const connectionIds = await gmailPushConnectionIds(systemCtx(orgId), address);
  if (connectionIds.length > 0) {
    await inngest.send(
      connectionIds.map((connectionId) => connectionPollDue.create({ orgId, connectionId })),
    );
  }
  return { status: 204 };
}

// The notification's mailbox address, or undefined (logged, naming no address) for a body that
// isn't a Pub/Sub push of a Gmail notification.
function parseNotification(rawBody: string): string | undefined {
  const body = pushBody.safeParse(parseJson(rawBody));
  const data = body.success ? Buffer.from(body.data.message.data, "base64").toString() : "";
  const notification = gmailNotification.safeParse(parseJson(data));
  if (notification.success) return notification.data.emailAddress;
  const messageId = body.success ? (body.data.message.messageId ?? "unknown") : "unknown";
  console.warn(`Dropped a malformed Gmail push notification (Pub/Sub message ${messageId}).`);
  return undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
