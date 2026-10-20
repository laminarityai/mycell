// Finding the workflow in the caller's org, which every workflows write and admin read does
// after the admin check (`requireAdmin`, from @/lib/ctx).
import { eq } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import type { Ctx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { workflows } from "./schema";

type Workflow = typeof workflows.$inferSelect;

export async function findWorkflow(ctx: Ctx, workflowId: string): Promise<Workflow> {
  const rows = await forOrg(ctx).select(workflows, {
    where: eq(workflows.id, workflowId),
    limit: 1,
  });
  const row = rows.at(0);
  if (row === undefined) throw new NotFoundError("workflow");
  return row;
}
