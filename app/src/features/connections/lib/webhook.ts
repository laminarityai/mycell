// Nango's webhooks. A signed `auth` / `creation` webhook is the only thing that records a
// connection: the browser's word that a popup finished is never trusted. A signed `auth` /
// `deletion` webhook forgets one.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { isUniqueViolation } from "@/db/errors";
import { forOrg } from "@/db/for-org";
import { findCtx, listUsers } from "@/features/orgs/server";
import type { Ctx } from "@/lib/ctx";
import { ATTEMPT_TAGS } from "./connect";
import { forgetNangoConnection } from "./disconnect";
import { deleteNangoConnection, isSignedByNango, NANGO_SIGNATURE_HEADER } from "./nango";
import { connectAttempts, connections } from "./schema";
import { INTEGRATIONS, readAccountEmail } from "./sources";

// The tags startConnect put on the connect session.
const attemptTags = z.object({
  [ATTEMPT_TAGS.attempt]: z.string().min(1),
  [ATTEMPT_TAGS.org]: z.string().min(1),
  [ATTEMPT_TAGS.user]: z.string().min(1),
});

const authWebhook = z.object({
  type: z.literal("auth"),
  operation: z.string(),
  success: z.boolean(),
  connectionId: z.string().min(1),
  providerConfigKey: z.string().min(1),
  tags: z.record(z.string(), z.string()).optional(),
});
type AuthWebhook = z.infer<typeof authWebhook>;

type Attempt = typeof connectAttempts.$inferSelect;

/**
 * Handles one webhook from Nango, given its raw body and headers. A bad signature is 401 and
 * changes nothing. Anything else is 200, including webhooks Mycel ignores, so Nango doesn't
 * retry them.
 */
export async function handleNangoWebhook(
  rawBody: string,
  headers: Headers,
): Promise<{ status: 200 | 401 }> {
  if (!isSignedByNango(rawBody, headers.get(NANGO_SIGNATURE_HEADER))) return { status: 401 };
  const parsed = authWebhook.safeParse(parseJson(rawBody));
  if (parsed.success && parsed.data.operation === "creation") await settleAttempt(parsed.data);
  if (parsed.success && parsed.data.operation === "deletion") await forget(parsed.data);
  return { status: 200 };
}

// The connection was deleted at Nango. Its signed tags name the org it was made in, which is
// the only org the row can be in. Nobody in Mycel is acting, so the ctx carries that org, the
// user who connected it, and the lesser role: forgetting checks no role.
async function forget(webhook: AuthWebhook): Promise<void> {
  const tags = attemptTags.safeParse(webhook.tags);
  if (!webhook.success || !tags.success) return;
  const orgCtx: Ctx = {
    orgId: tags.data[ATTEMPT_TAGS.org],
    userId: tags.data[ATTEMPT_TAGS.user],
    role: "member",
  };
  await forgetNangoConnection(orgCtx, webhook.connectionId, webhook.providerConfigKey);
}

async function settleAttempt(webhook: AuthWebhook): Promise<void> {
  const found = await findAttempt(webhook);
  if (found === undefined) return;
  const { ctx, attempt } = found;
  if (attempt.status !== "pending" || INTEGRATIONS[attempt.source] !== webhook.providerConfigKey) {
    return;
  }
  if (!webhook.success) {
    await refuse(ctx, attempt, "Google didn't finish connecting. Try again.");
    return;
  }
  const accountEmail = await readAccountEmail(attempt.source, webhook.connectionId);
  const refusal = await checkAccount(ctx, accountEmail);
  if (refusal !== undefined) {
    await deleteNangoConnection(webhook.connectionId, webhook.providerConfigKey);
    await refuse(ctx, attempt, refusal);
    return;
  }
  await record(ctx, attempt, webhook, accountEmail);
}

// The attempt the webhook's tags name, read as its user, who must still be in the org the
// attempt was started in. A webhook naming no live attempt is ignored.
async function findAttempt(webhook: AuthWebhook) {
  const tags = attemptTags.safeParse(webhook.tags);
  if (!tags.success) return undefined;
  const attemptId = tags.data[ATTEMPT_TAGS.attempt];
  const userId = tags.data[ATTEMPT_TAGS.user];
  const ctx = await findCtx(userId);
  if (ctx === undefined || ctx.orgId !== tags.data[ATTEMPT_TAGS.org]) return undefined;
  const rows = await forOrg(ctx).select(connectAttempts, {
    where: and(eq(connectAttempts.id, attemptId), eq(connectAttempts.userId, userId)),
  });
  const attempt = rows.at(0);
  return attempt === undefined ? undefined : { ctx, attempt };
}

// Why this account can't be connected as the caller's own, or undefined if it can.
async function checkAccount(ctx: Ctx, accountEmail: string): Promise<string | undefined> {
  const users = await listUsers(ctx);
  const me = users.find((user) => user.id === ctx.userId);
  if (me?.email.toLowerCase() !== accountEmail) {
    return `You can only connect your own account (${me?.email ?? "your sign-in address"}), not ${accountEmail}.`;
  }
  return undefined;
}

async function record(
  ctx: Ctx,
  attempt: Attempt,
  webhook: AuthWebhook,
  accountEmail: string,
): Promise<void> {
  try {
    await forOrg(ctx).insert(connections, {
      id: randomUUID(),
      kind: attempt.kind,
      ownerUserId: attempt.userId,
      source: attempt.source,
      accountEmail,
      nangoConnectionId: webhook.connectionId,
      status: "active",
    });
  } catch (error) {
    // Nango redelivered a webhook that's already recorded.
    if (isUniqueViolation(error, "connections_nango_connection_id_unique")) return;
    if (!isUniqueViolation(error, "connections_org_id_source_account_unique")) throw error;
    await deleteNangoConnection(webhook.connectionId, webhook.providerConfigKey);
    await refuse(ctx, attempt, `${accountEmail} is already connected.`);
    return;
  }
  await forOrg(ctx).update(
    connectAttempts,
    { status: "connected" },
    eq(connectAttempts.id, attempt.id),
  );
}

async function refuse(ctx: Ctx, attempt: Attempt, refusal: string): Promise<void> {
  await forOrg(ctx).update(
    connectAttempts,
    { status: "refused", refusal },
    eq(connectAttempts.id, attempt.id),
  );
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
