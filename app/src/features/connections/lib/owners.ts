// Whose each connection is, and clients for several at once: for a list of what ran on many
// connections (the Runs page), read in the same queries however many connections there are.
import { inArray } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { type Ctx, isAdmin, isSystem } from "@/lib/ctx";
import type { ConnectionOwnership, SourceClient } from "../types";
import { ownerLookup } from "./list";
import { connections } from "./schema";
import { clientOf, isReadableBy } from "./source-access";

/**
 * The connections the caller may know of, each with its owner and whether the caller may read
 * what it reaches: every connection in the org for an admin (another member's by its owner's
 * name alone), a member's own for a member.
 */
export async function connectionOwners(ctx: Ctx): Promise<ConnectionOwnership[]> {
  const rows = await forOrg(ctx).select(connections, {
    orderBy: [connections.createdAt, connections.id],
  });
  const ownerOf = await ownerLookup(ctx);
  const everyone = isAdmin(ctx) || isSystem(ctx);
  return rows.flatMap((row) => {
    const readable = isReadableBy(ctx, row);
    if (!readable && !everyone) return [];
    return [
      {
        id: row.id,
        kind: row.kind,
        readable,
        accountEmail: readable ? row.accountEmail : null,
        owner: ownerOf(row.ownerUserId),
      },
    ];
  });
}

/**
 * A source client for each of these connections the caller may read, by ID, their access
 * checked as `sourceClient` checks it, in one query. One they may not read, or that's gone, has
 * none.
 */
export async function sourceClients(
  ctx: Ctx,
  connectionIds: string[],
): Promise<Map<string, SourceClient>> {
  const ids = [...new Set(connectionIds)];
  if (ids.length === 0) return new Map();
  const rows = await forOrg(ctx).select(connections, { where: inArray(connections.id, ids) });
  return new Map(
    rows.filter((row) => isReadableBy(ctx, row)).map((row) => [row.id, clientOf(row)]),
  );
}
