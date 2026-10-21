// Finding the workflow in the caller's org, which every workflows write and admin read does
// after the admin check (`requireAdmin`, from @/lib/ctx).
import { eq } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { readStoredSpec } from "@/features/spec/stored";
import type { Spec } from "@/features/spec/types";
import type { Ctx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { workflows } from "./schema";

/** A workflow's row, its working spec read in the current version's shape. */
type Workflow = Omit<typeof workflows.$inferSelect, "workingSpec"> & { workingSpec: Spec };

export async function findWorkflow(ctx: Ctx, workflowId: string): Promise<Workflow> {
  const rows = await forOrg(ctx).select(workflows, {
    where: eq(workflows.id, workflowId),
    limit: 1,
  });
  const row = rows.at(0);
  if (row === undefined) throw new NotFoundError("workflow");
  return { ...row, workingSpec: readStoredSpec(row.workingSpec) };
}
