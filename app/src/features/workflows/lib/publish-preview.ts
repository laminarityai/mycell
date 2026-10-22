// The publish dialog's warning: what publishing would do to members' enablements, before the
// admin confirms.
import { forOrg } from "@/db/for-org";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import type { PublishPreview } from "../types";
import { findWorkflow } from "./access";
import { enablements } from "./schema";
import { checkedByPolicy } from "./validation";
import { gainedForEnablements, gainedSince, onEnablements } from "./version-pauses";
import { latestVersions } from "./latest-versions";

/**
 * What publishing `spec` as the workflow's next version would do: what it needs that the latest
 * version didn't, and how many enablements that are on publishing would pause, counted as
 * publishing pauses them. Admins only. The spec is checked by its schema and the policy engine
 * alone (SpecInvalidError): publishing checks the org's connections too.
 */
export async function previewPublish(
  ctx: Ctx,
  workflowId: string,
  spec: unknown,
): Promise<PublishPreview> {
  requireAdmin(ctx);
  await findWorkflow(ctx, workflowId);
  const next = checkedByPolicy(spec);
  const latest = (await latestVersions(ctx, [workflowId])).get(workflowId);
  const gained = latest === undefined ? null : gainedSince(latest, next);
  const pausing = gainedForEnablements(latest, next);
  if (pausing === null) return { gained, pauses: 0 };
  const on = await forOrg(ctx).select(enablements, { where: onEnablements(workflowId) });
  return { gained, pauses: on.length };
}
