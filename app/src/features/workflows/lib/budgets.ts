// Each workflow's monthly credit budget, as its latest published version sets it: what the
// Credits page shows a workflow's spending against. An edit in the editor counts once it's
// published, as everything switched on follows the latest version.
import { forOrg } from "@/db/for-org";
import { type Ctx, requireAdmin } from "@/lib/ctx";
import type { WorkflowBudget } from "../types";
import { latestVersions } from "./latest-versions";
import { workflows } from "./schema";

/** Every workflow in the org, by name, with its budget; admins only. */
export async function listWorkflowBudgets(ctx: Ctx): Promise<WorkflowBudget[]> {
  requireAdmin(ctx);
  const rows = await forOrg(ctx).select(workflows, {
    columns: ["id", "name", "archivedAt"],
    orderBy: [workflows.name],
  });
  const latest = await latestVersions(
    ctx,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    archived: row.archivedAt !== null,
    monthlyCredits: latest.get(row.id)?.spec.budget?.monthlyCredits ?? null,
  }));
}
