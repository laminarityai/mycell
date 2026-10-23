// The runs that paused a workflow for failing, as its Health check lists them for admins (M8):
// when each ended, whose inbox it ran on, the step that failed and the error. Only what an
// admin may see of a colleague's run: no message, no step outputs, and error messages that are
// built from codes (content-free, `failures.ts`).
import { and, inArray } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { listConnections } from "@/features/connections/server";
import type { ConnectionsListing } from "@/features/connections/types";
import type { PausingRun } from "@/features/workflows/types";
import { type Ctx, requireAdmin } from "@/lib/ctx";
import { INTERNAL_ERROR_MESSAGE } from "../types";
import { runs, runSteps } from "./schema";

/**
 * The runs `runIds` names, in that order, in the same queries however many. A run that's gone
 * (with its connection) is left out. Admins only.
 */
export async function pausingRuns(ctx: Ctx, runIds: readonly string[]): Promise<PausingRun[]> {
  requireAdmin(ctx);
  const ids = [...new Set(runIds)];
  if (ids.length === 0) return [];
  const [rows, failedSteps, listing] = await Promise.all([
    forOrg(ctx).select(runs, {
      columns: ["id", "connectionId", "errorCode", "finishedAt"],
      where: inArray(runs.id, ids),
    }),
    forOrg(ctx).select(runSteps, {
      columns: ["runId", "stepId", "errorCode", "errorMessage"],
      where: and(
        inArray(runSteps.runId, ids),
        inArray(runSteps.status, ["failed", "check_failed"]),
      ),
      orderBy: [runSteps.position],
    }),
    listConnections(ctx),
  ]);
  const inboxOf = inboxNames(listing);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const run = byId.get(id);
    if (run === undefined) return [];
    const step = failedSteps.find((failed) => failed.runId === id);
    const crashed = run.errorCode !== null || step === undefined;
    return [
      {
        runId: run.id,
        finishedAt: run.finishedAt,
        inbox: inboxOf(run.connectionId),
        failedStep: crashed ? null : step.stepId,
        error:
          crashed || step.errorCode === "internal_error"
            ? INTERNAL_ERROR_MESSAGE
            : (step.errorMessage ?? step.errorCode ?? "It failed."),
      },
    ];
  });
}

// Each connection by whose inbox it is, as an admin may know it: their own, an org connection's
// address, or a colleague's by name alone (ADR-0001).
function inboxNames(listing: ConnectionsListing): (connectionId: string) => string {
  const names = new Map<string, string>([
    ...listing.connections.map((one) => [one.id, "Your inbox"] as const),
    ...listing.orgConnections.map((one) => [one.id, one.accountEmail] as const),
    ...listing.memberConnections.map(
      (one) =>
        [
          one.id,
          one.owner.removed ? "A removed member's inbox" : `${one.owner.name}'s inbox`,
        ] as const,
    ),
  ]);
  return (connectionId) => names.get(connectionId) ?? "An inbox no longer connected";
}
