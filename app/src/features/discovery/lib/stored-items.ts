// The items discovery has stored, listed again as the pointers `discovery/item.stored` announced
// them with: each Gmail message but drafts. Memory counts them for its estimate, and learns
// from them when an admin starts it.
import { and, asc, eq, gt, not, sql, type SQL } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import type { Ctx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import type { StoredItem, StoredItemsPage } from "../types";
import { events } from "./schema";

// What `announce.ts` sends `discovery/item.stored` for.
function announced(): SQL | undefined {
  return and(eq(events.source, "gmail"), not(sql`'DRAFT' = any(${events.labelIds})`));
}

/** How many items discovery has stored in the org. Admins (and jobs) only. */
export async function countStoredItems(ctx: Ctx): Promise<number> {
  if (ctx.role === "member") throw new ForbiddenError();
  return forOrg(ctx).count(events, announced());
}

/**
 * One page of the org's stored items, `limit` at most, after the page `after` names. `next`
 * names the next page, or is null after the last. Admins (and jobs) only.
 */
export async function listStoredItems(
  ctx: Ctx,
  page: { after?: string; limit: number },
): Promise<StoredItemsPage> {
  if (ctx.role === "member") throw new ForbiddenError();
  const rows = await forOrg(ctx).select(events, {
    where: and(announced(), page.after === undefined ? undefined : gt(events.id, page.after)),
    orderBy: [asc(events.id)],
    limit: page.limit,
  });
  const items = rows.map((row): StoredItem => ({
    connectionId: row.connectionId,
    app: "gmail",
    sourceRef: row.sourceRef,
    occurredAt: row.occurredAt,
  }));
  return { items, next: rows.length < page.limit ? null : (rows.at(-1)?.id ?? null) };
}
