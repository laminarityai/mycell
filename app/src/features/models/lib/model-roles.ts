// Model roles (invariant 6): code and specs name a role, and it resolves to a model per org at
// runtime. An org's own row wins; without one, the role's global default from config is used.
import { eq } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { env, modelIdSchema } from "@/env";
import type { ModelRole } from "@/features/spec/types";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import { ValidationError } from "@/lib/errors";
import { now } from "@/lib/time";
import { modelRoles } from "./schema";

const DEFAULT_MODELS: Record<ModelRole, string> = {
  classify: env.MODEL_CLASSIFY,
  fast: env.MODEL_FAST,
  smart: env.MODEL_SMART,
  judge: env.MODEL_JUDGE,
  embed: env.MODEL_EMBED,
};

/** Whether a model is a decision model, asked through experimental_decide (config lists them). */
export function isDecisionModel(modelId: string): boolean {
  return env.MODEL_DECISION_PREFIXES.some((prefix) => modelId.startsWith(prefix));
}

/** The gateway model ID the role names in the caller's org. */
export async function resolveModel(ctx: Ctx, role: ModelRole): Promise<string> {
  const rows = await forOrg(ctx).select(modelRoles, { where: eq(modelRoles.role, role) });
  return rows.at(0)?.modelId ?? DEFAULT_MODELS[role];
}

/** Points one of the org's roles at a gateway model. Admins only; no UI until later. */
export async function setModelRole(ctx: Ctx, role: ModelRole, modelId: string): Promise<void> {
  requireAdmin(ctx);
  const parsed = modelIdSchema.safeParse(modelId);
  if (!parsed.success) throw new ValidationError("A model ID looks like provider/model.");

  const db = forOrg(ctx);
  const where = eq(modelRoles.role, role);
  const set = { modelId: parsed.data, updatedAt: now() };
  if ((await db.update(modelRoles, set, where)).length > 0) return;
  const inserted = await db.insert(modelRoles, { role, ...set }, { onConflictDoNothing: true });
  // Another write inserted the row first: this one still wins, as the latest.
  if (inserted.length === 0) await db.update(modelRoles, set, where);
}
