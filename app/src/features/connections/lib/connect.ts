import { randomUUID } from "node:crypto";
import { listUsers } from "@/features/orgs/server";
import { forOrg } from "@/db/for-org";
import type { Ctx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import type { ConnectionKind, Source } from "../types";
import { createConnectSession } from "./nango";
import { connectAttempts } from "./schema";
import { INTEGRATIONS } from "./sources";

/**
 * Tags Mycel puts on a connect session; Nango copies them onto the connection's webhooks. The
 * user and org use Nango's recommended keys, which its dashboard displays.
 */
export const ATTEMPT_TAGS = {
  attempt: "mycel_attempt_id",
  org: "organization_id",
  user: "end_user_id",
  email: "end_user_email",
} as const;

/**
 * Starts connecting a source: records a pending connect attempt and returns the token Nango's
 * Connect UI opens with. Nango's creation webhook settles it. A member connection reaches the
 * caller's own account; an org connection reaches a shared one, and only admins make those.
 */
export async function startConnect(
  ctx: Ctx,
  source: Source,
  kind: ConnectionKind = "member",
): Promise<{ token: string }> {
  if (kind === "org" && ctx.role !== "admin") throw new ForbiddenError();
  const users = await listUsers(ctx);
  const me = users.find((user) => user.id === ctx.userId);
  if (me === undefined) throw new Error("The caller isn't a user of their own org");
  const attemptId = randomUUID();
  await forOrg(ctx).insert(connectAttempts, {
    id: attemptId,
    userId: ctx.userId,
    kind,
    source,
    status: "pending",
  });
  const token = await createConnectSession({
    integration: INTEGRATIONS[source],
    tags: {
      [ATTEMPT_TAGS.attempt]: attemptId,
      [ATTEMPT_TAGS.org]: ctx.orgId,
      [ATTEMPT_TAGS.user]: ctx.userId,
      [ATTEMPT_TAGS.email]: me.email,
    },
  });
  return { token };
}
