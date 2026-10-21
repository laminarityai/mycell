// What a new message may start, decided when it arrives: the trigger's fan-out reads it as the
// system ctx (ADR-0009). It is narrower than what's switched on, which a run in progress checks
// before each step: a pause, an archive or lost visibility stops new runs, while a run already
// under way finishes on the version it started on.
import { and, inArray, isNotNull } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import type { Ctx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import type { SwitchedOn } from "../types";
import { enablements, workflows } from "./schema";
import { listSwitchedOn } from "./switches";
import { seenByUsers } from "./visibility";

/**
 * The switches on `connectionId` a new message starts runs for, of workflows not archived:
 * every org switch, and each enablement that is `on` and whose user can still see the
 * workflow's latest version. Whether the connection itself may run (Google still accepts it)
 * is the caller's to check.
 */
export async function listStartable(ctx: Ctx, connectionId: string): Promise<SwitchedOn[]> {
  if (ctx.role !== "system") throw new ForbiddenError();
  const switchedOn = await withoutArchived(ctx, await listSwitchedOn(ctx, connectionId));
  const enablementIds = switchedOn.flatMap(({ switch: by }) =>
    by.kind === "member" ? [by.enablementId] : [],
  );
  const rows =
    enablementIds.length === 0
      ? []
      : await forOrg(ctx).select(enablements, { where: inArray(enablements.id, enablementIds) });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const seen = await seenByUsers(
    ctx,
    switchedOn.flatMap((on) => {
      const row = on.switch.kind === "member" ? byId.get(on.switch.enablementId) : undefined;
      return row === undefined ? [] : [{ userId: row.userId, versionId: on.versionId }];
    }),
  );
  return switchedOn.filter((on) => {
    if (on.switch.kind === "org") return true;
    const row = byId.get(on.switch.enablementId);
    return row?.status === "on" && seen(row.userId, on.versionId);
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
