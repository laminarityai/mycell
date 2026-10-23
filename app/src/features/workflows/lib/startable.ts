// What a new message may start, decided when it arrives: the trigger's fan-out reads it as the
// system ctx (ADR-0009). It is narrower than what's switched on, which a run in progress checks
// before each step: a pause (stored or worked out, `pauses.ts`), an archive or lost visibility
// stops new runs, while a run already under way finishes on the version it started on. Nothing
// is queued meanwhile: a message that arrives during a pause never starts a run.
import { and, inArray, isNotNull } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { type Ctx, requireSystem } from "@/lib/ctx";
import type { SwitchedOn } from "../types";
import { enablements, workflows } from "./schema";
import { pausesOf, readHolds } from "./pauses";
import { listSwitchedOn } from "./switches";
import { seenByUsers } from "./visibility";

/**
 * The switches on `connectionId` a new message starts runs for, of workflows not archived and
 * not paused: every such org switch, and each such enablement whose user can still see the
 * workflow's latest version. While the company is out of credits, none. Whether the connection
 * itself may run (Google still accepts it) is the caller's to check.
 */
export async function listStartable(ctx: Ctx, connectionId: string): Promise<SwitchedOn[]> {
  requireSystem(ctx);
  const switchedOn = await withoutArchived(ctx, await listSwitchedOn(ctx, connectionId));
  const enablementIds = switchedOn.flatMap(({ switch: by }) =>
    by.kind === "member" ? [by.enablementId] : [],
  );
  const rows =
    enablementIds.length === 0
      ? []
      : await forOrg(ctx).select(enablements, { where: inArray(enablements.id, enablementIds) });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const [seen, holds] = await Promise.all([
    seenByUsers(
      ctx,
      switchedOn.flatMap((on) => {
        const row = on.switch.kind === "member" ? byId.get(on.switch.enablementId) : undefined;
        return row === undefined ? [] : [{ userId: row.userId, versionId: on.versionId }];
      }),
    ),
    readHolds(
      ctx,
      switchedOn.map((on) => on.workflowId),
    ),
  ]);
  return switchedOn.filter((on) => {
    const holding = holds(on.workflowId);
    if (on.switch.kind === "org") return pausesOf(null, holding).length === 0;
    const row = byId.get(on.switch.enablementId);
    return (
      row !== undefined && pausesOf(row, holding).length === 0 && seen(row.userId, on.versionId)
    );
  });
}

// The switches of workflows that aren't archived.
async function withoutArchived(ctx: Ctx, switchedOn: SwitchedOn[]): Promise<SwitchedOn[]> {
  if (switchedOn.length === 0) return switchedOn;
  const archived = await forOrg(ctx).select(workflows, {
    where: and(
      inArray(
        workflows.id,
        switchedOn.map((on) => on.workflowId),
      ),
      isNotNull(workflows.archivedAt),
    ),
  });
  const skipped = new Set(archived.map((row) => row.id));
  return switchedOn.filter((on) => !skipped.has(on.workflowId));
}
