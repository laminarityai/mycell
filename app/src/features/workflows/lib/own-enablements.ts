// What a person has switched on for their own inbox, for Ask Mycel (#181): their enablements of
// member-credential workflows that aren't archived and that they can still see, each with every
// pause that holds (`pauses.ts`). An org switch is no one's own, and admin rights add nothing
// but what an admin sees anyway, so an admin's list is a member's with the same switches.
import { and, eq, inArray, isNull } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { isAdmin, requireRole, type Ctx } from "@/lib/ctx";
import type { OwnEnablement } from "../types";
import { latestVersions } from "./latest-versions";
import { pausesOf, readHolds } from "./pauses";
import { enablements, workflows } from "./schema";
import { sharingATag } from "./visibility";

/** The caller's own enablements, oldest first. People only: the system ctx is no one. */
export async function listOwnEnablements(ctx: Ctx): Promise<OwnEnablement[]> {
  requireRole(ctx, "admin", "member");
  const db = forOrg(ctx);
  const own = await db.select(enablements, {
    columns: ["workflowId", "status", "pausedReason", "pausedChange", "enabledAt"],
    where: eq(enablements.userId, ctx.userId),
    orderBy: [enablements.enabledAt, enablements.id],
  });
  if (own.length === 0) return [];
  const ids = own.map((row) => row.workflowId);
  const [live, latest, holds] = await Promise.all([
    db.select(workflows, {
      columns: ["id", "name"],
      where: and(inArray(workflows.id, ids), isNull(workflows.archivedAt)),
    }),
    latestVersions(ctx, ids),
    readHolds(ctx, ids),
  ]);
  const names = new Map(live.map((row) => [row.id, row.name]));
  // Republished for an org connection, archived, or no longer published to them: not on.
  const published = own.flatMap((row) => {
    const name = names.get(row.workflowId);
    const version = latest.get(row.workflowId);
    if (name === undefined || version?.spec.credentials !== "member") return [];
    return [{ row, name, version }];
  });
  const seen = isAdmin(ctx)
    ? published
    : await sharingATag(
        ctx,
        published,
        published.map(({ version }) => version.id),
      );
  return seen.map(({ row, name }) => ({
    workflowId: row.workflowId,
    name,
    since: row.enabledAt,
    pauses: pausesOf(row, holds(row.workflowId)),
    pausedChange: row.pausedChange,
  }));
}
