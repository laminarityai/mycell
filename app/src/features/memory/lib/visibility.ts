// Who sees what memory holds (ADR-0023), one function every read goes through. A viewer sees a
// source record when:
// - their own mailbox holds the item: this copy, or another under the same item key;
// - their address is on its access list;
// - it came from an org connection, such as support@;
// - or its access list names a list an admin marked company-wide, such as all@.
// A fact is visible when one of its source records is, and an object when one of its facts is.
// Group membership is never guessed: a group that isn't marked counts only through a copy in the
// viewer's own mailbox. Admin rights widen nothing, and the system ctx (an org-credential run) is
// no one, so it sees only what's company-wide. Docs shared with the domain join with Drive.
import { and, eq, inArray } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { listUsers } from "@/features/orgs/server";
import type { Ctx } from "@/lib/ctx";
import { markedAddresses } from "./company-wide-lists";
import { accessListEntries, sourceRecords } from "./schema";

/** Who is reading: a user, with their own address, or no one (the system ctx). */
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
  const records = await db.select(sourceRecords, { where: inArray(sourceRecords.id, ids) });
  if (records.length === 0) return new Set();

  // The items the viewer's own mailbox holds a copy of, by app and item key.
  const held =
    viewer.userId === null
      ? []
      : await db.select(sourceRecords, {
          where: and(
            eq(sourceRecords.ownerScope, "member"),
            eq(sourceRecords.ownerUserId, viewer.userId),
            inArray(sourceRecords.itemKey, [...new Set(records.map((record) => record.itemKey))]),
          ),
        });
  const heldItems = new Set(held.map(itemOf));

  // The viewer's own address, and every company-wide list's. A marked address that has since
  // become a person's own counts as theirs, not as a list's.
  const addresses = [...new Set([...viewer.addresses, ...(await companyWideLists(ctx))])];
  const addressedTo =
    addresses.length === 0
      ? []
      : await db.select(accessListEntries, {
          where: and(
            inArray(accessListEntries.sourceRecordId, ids),
            eq(accessListEntries.kind, "address"),
            inArray(accessListEntries.value, addresses),
          ),
        });
  const addressed = new Set(addressedTo.map((entry) => entry.sourceRecordId));

  return new Set(
    records
      .filter(
        (record) =>
          record.ownerScope === "org" || heldItems.has(itemOf(record)) || addressed.has(record.id),
      )
      .map((record) => record.id),
  );
}

async function companyWideLists(ctx: Ctx): Promise<string[]> {
  const marked = await markedAddresses(ctx);
  if (marked.length === 0) return [];
  const people = new Set((await listUsers(ctx)).map((user) => user.email.toLowerCase()));
  return marked.filter((address) => !people.has(address));
}

function itemOf(record: { app: string; itemKey: string }): string {
  return `${record.app}\n${record.itemKey}`;
}
