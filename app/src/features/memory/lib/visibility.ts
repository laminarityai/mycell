// Who sees what memory holds (ADR-0023), one function every read goes through. A viewer sees a
// source record when their own connection holds it, or their address is on its access list. A
// fact is visible when one of its source records is, and an object when one of its facts is.
// Company-wide sources (an org connection, a list an admin marked, a copy in the viewer's own
// mailbox, a doc shared with the domain) join with their tickets. Admin rights widen nothing.
import { and, eq, inArray } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { listUsers } from "@/features/orgs/server";
import type { Ctx } from "@/lib/ctx";
import { accessListEntries, sourceRecords } from "./schema";

/**
 * Who is reading: a user, with their own address. The system ctx is no one, so it sees only
 * what's company-wide.
 */
export type Viewer = { userId: string | null; addresses: string[] };

export async function viewerOf(ctx: Ctx): Promise<Viewer> {
  if (ctx.role === "system") return { userId: null, addresses: [] };
  const me = (await listUsers(ctx)).find((user) => user.id === ctx.userId);
  return { userId: ctx.userId, addresses: me === undefined ? [] : [me.email.toLowerCase()] };
}

/** Which of the source records `ids` the viewer may see. */
export async function visibleSourceRecords(
  ctx: Ctx,
  viewer: Viewer,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const db = forOrg(ctx);
  const own =
    viewer.userId === null
      ? []
      : await db.select(sourceRecords, {
          where: and(
            inArray(sourceRecords.id, ids),
            eq(sourceRecords.ownerScope, "member"),
            eq(sourceRecords.ownerUserId, viewer.userId),
          ),
        });
  const addressedTo =
    viewer.addresses.length === 0
      ? []
      : await db.select(accessListEntries, {
          where: and(
            inArray(accessListEntries.sourceRecordId, ids),
            eq(accessListEntries.kind, "address"),
            inArray(accessListEntries.value, viewer.addresses),
          ),
        });
  return new Set([
    ...own.map((record) => record.id),
    ...addressedTo.map((entry) => entry.sourceRecordId),
  ]);
}
