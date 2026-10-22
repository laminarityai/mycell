// An org's custom actions and its action set (ADR-0018): every action its workflows may use.
// Saving, checking and publishing a workflow, running it, Try it and the builder chat each
// resolve the set once and hand it to the policy engine and everything else that looks an action
// up. Custom actions are only ever inserted: a changed one is a new one, with a new name.
import { asc, inArray } from "drizzle-orm";
import { isUniqueViolation } from "@/db/errors";
import { forOrg, type OrgScopedDb } from "@/db/for-org";
import type { ActionSet } from "@/features/policy/types";
import { sameValue } from "@/features/spec/diff";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import { ConflictError } from "@/lib/errors";
import { actionSetWith, checkedCustomActions } from "../description";
import type { CustomActionRecord, StoredCustomAction } from "../types";
import { customActions } from "./schema";

/** The actions the caller's org may use: the catalog, then its custom actions. */
export async function getActionSet(ctx: Ctx): Promise<ActionSet> {
  return actionSetWith(await listCustomActions(ctx));
}

/**
 * The org's custom actions, oldest first, for any of its users: they're as much a part of
 * its workflows as the catalog is, and hold nothing from anyone's account.
 */
export async function listCustomActions(ctx: Ctx): Promise<StoredCustomAction[]> {
  const rows = await forOrg(ctx).select(customActions, {
    orderBy: [asc(customActions.acceptedAt), asc(customActions.name)],
  });
  return rows.map((row) => ({
    ...row.description,
    risk: row.risk,
    id: row.id,
    acceptedBy: row.acceptedBy,
    acceptedAt: row.acceptedAt,
    proposalId: row.proposalId,
  }));
}

/**
 * Stores the custom actions an admin accepted, as accepted by them from `proposalId`. Each is
 * checked again, and its level set again by the fixed rule. One the org already has, the
 * same, is left as it is; one with a taken name that does something else is ConflictError,
 * since a stored action never changes. `db` is a transaction to store them in, when the caller
 * stores them together with what uses them.
 */
export async function storeCustomActions(
  ctx: Ctx,
  records: readonly CustomActionRecord[],
  origin: { proposalId?: string },
  db: OrgScopedDb = forOrg(ctx),
): Promise<void> {
  requireAdmin(ctx);
  if (records.length === 0) return;
  const checked = checkedCustomActions(records);
  const existing = await db.select(customActions, {
    where: inArray(
      customActions.name,
      checked.map((action) => action.name),
    ),
  });
  const fresh = checked.filter(({ risk, ...description }) => {
    const stored = existing.find((row) => row.name === description.name);
    if (stored === undefined) return true;
    if (stored.risk === risk && sameValue(stored.description, description)) return false;
    throw takenName(description.name);
  });
  try {
    await db.insert(
      customActions,
      fresh.map(({ risk, ...description }) => ({
        id: crypto.randomUUID(),
        name: description.name,
        app: description.app,
        description,
        risk,
        acceptedBy: ctx.userId,
        proposalId: origin.proposalId ?? null,
      })),
    );
  } catch (error) {
    // Another admin stored one of the names at the same moment.
    if (!isUniqueViolation(error, "custom_actions_org_id_name_unique")) throw error;
    throw takenName(fresh.map((action) => action.name).join(", "));
  }
}

function takenName(name: string): ConflictError {
  return new ConflictError(
    `This org already has a custom action named "${name}" that does something else. A stored custom action never changes: a changed one needs a new name, such as "${name}-v2".`,
  );
}
