// What a new version does to the enablements of the workflow it's published for (M5). They
// follow it, unless it needs what the version before it didn't (the policy engine decides that
// from the company's action set): a higher max risk, a new app or a new scope. Then every one
// that's on pauses until its member enables it again, so a member's mailbox never does something
// riskier, or reads something new, without their say. An org switch always follows: the admin
// publishing is the one who would switch it on again.
import { and, eq } from "drizzle-orm";
import type { OrgScopedDb } from "@/db/for-org";
import { requirementsGained } from "@/features/policy/engine";
import type { ActionSet, Requirements, RequirementsGained } from "@/features/policy/types";
import type { Spec } from "@/features/spec/types";
import type { PausedChange } from "../types";
import { enablements } from "./schema";

/**
 * What publishing `next` after `previous` makes enablements wait for their members over: what
 * it gains, when the workflow runs on members' own connections. Null when it gains nothing,
 * it's the first version, or it runs on an org connection.
 */
export function gainedForEnablements(
  previous: Requirements | undefined,
  next: Requirements & { credentials: Spec["credentials"] },
  actions: ActionSet,
): RequirementsGained | null {
  if (previous === undefined || next.credentials !== "member") return null;
  return requirementsGained(previous, next, actions);
}

/** Each enablement of the workflow that's on: what a pause would pause. */
export function onEnablements(workflowId: string) {
  return and(eq(enablements.workflowId, workflowId), eq(enablements.status, "on"));
}

/**
 * Pauses, in the publish's transaction, every enablement of the workflow that's on, saying what
 * the new version gained. One already paused is still waiting for its member, so what this
 * version gained is added to what it's paused for. Returns how many it paused.
 */
export async function pauseEnablements(
  tx: OrgScopedDb,
  workflowId: string,
  gained: RequirementsGained,
): Promise<number> {
  const waiting = await tx.select(enablements, {
    where: and(eq(enablements.workflowId, workflowId), eq(enablements.status, "paused")),
  });
  for (const row of waiting) {
    await tx.update(
      enablements,
      { pausedChange: merged(row.pausedChange, gained) },
      eq(enablements.id, row.id),
    );
  }
  const paused = await tx.update(
    enablements,
    { status: "paused", pausedReason: "needs_reenable", pausedChange: gained },
    onEnablements(workflowId),
  );
  return paused.length;
}

// What an enablement is paused for, with what a later version gained on top: the risk raised
// from where its member last enabled it to the newest level, and every new app and scope.
function merged(before: PausedChange | null, gained: RequirementsGained): PausedChange {
  const raised = before?.maxRiskRaised ?? gained.maxRiskRaised;
  const to = gained.maxRiskRaised?.to ?? raised?.to;
  const apps = union(before?.newApps, gained.newApps);
  const scopes = union(before?.newScopes, gained.newScopes);
  return {
    ...(raised === undefined || to === undefined
      ? {}
      : { maxRiskRaised: { from: raised.from, to } }),
    ...(apps.length === 0 ? {} : { newApps: apps }),
    ...(scopes.length === 0 ? {} : { newScopes: scopes }),
  };
}

function union<T extends string>(a: readonly T[] = [], b: readonly T[] = []): T[] {
  return [...new Set([...a, ...b])];
}
