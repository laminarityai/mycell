// Who sees what memory holds (ADR-0023), one function every read goes through. A viewer sees a
// source record when:
// - their own mailbox or Drive holds the item: this copy, or another under the same item key;
// - their address, or their address's domain, is on its access list;
// - it came from an org connection, such as support@;
// - or its access list makes it company-wide: it names a list an admin marked company-wide (such
//   as all@), the company's Workspace domain (a doc shared with the company), or anyone (a doc
//   shared with anyone who has the link).
// A fact is visible when one of its source records is, and an object when one of its facts is.
// Group membership is never guessed: a group that isn't marked counts only through a copy in the
// viewer's own mailbox or Drive. Admin rights widen nothing, and the system ctx (an
// org-credential run) is no one, so it sees only what's company-wide.
import { and, eq, inArray, or } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { getWorkspaceDomain, listUsers } from "@/features/orgs/server";
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
  // The company's domain, and the viewer's own address's.
  const domains = [
    ...new Set([
      (await getWorkspaceDomain(ctx)).toLowerCase(),
      ...viewer.addresses.map((address) => address.slice(address.lastIndexOf("@") + 1)),
    ]),
  ];
  const sharedWith = await db.select(accessListEntries, {
    where: and(
      inArray(accessListEntries.sourceRecordId, ids),
      or(
        eq(accessListEntries.kind, "anyone"),
        and(eq(accessListEntries.kind, "domain"), inArray(accessListEntries.value, domains)),
        addresses.length === 0
          ? undefined
          : and(eq(accessListEntries.kind, "address"), inArray(accessListEntries.value, addresses)),
      ),
    ),
  });
  const addressed = new Set(sharedWith.map((entry) => entry.sourceRecordId));

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
