// Archiving (M5): an admin stops a workflow everywhere at once. Members no longer see it, and
// the trigger's fan-out starts nothing for its enablements or its org switch (startable.ts). The
// enablements and the switch are kept, so restoring brings everyone back as they were, on the
// same latest version: restoring publishes nothing.
import { eq } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import { now } from "@/lib/time";
import { findWorkflow } from "./access";
import { workflows } from "./schema";

/** Archives the workflow; archiving it again keeps when it was first archived. */
export async function archiveWorkflow(ctx: Ctx, workflowId: string): Promise<void> {
  requireAdmin(ctx);
  const workflow = await findWorkflow(ctx, workflowId);
  if (workflow.archivedAt !== null) return;
  await forOrg(ctx).update(workflows, { archivedAt: now() }, eq(workflows.id, workflowId));
}

/** Restores an archived workflow, with everyone's enablements and its org switch as they were. */
export async function restoreWorkflow(ctx: Ctx, workflowId: string): Promise<void> {
  requireAdmin(ctx);
  await findWorkflow(ctx, workflowId);
  await forOrg(ctx).update(workflows, { archivedAt: null }, eq(workflows.id, workflowId));
}
