// Who sees what memory holds (ADR-0023), one rule every read goes through. A viewer sees a
// source record when:
// - their own mailbox or Drive holds the item: this copy, or another under the same item key;
// - their address is on its confirmed access list;
// - it came from an org connection, such as support@;
// - or its confirmed access list makes it company-wide: it names a list an admin marked
//   company-wide (such as all@), the company's Workspace domain (a doc shared with the company),
//   or anyone (a doc shared with anyone who has the link).
// A fact is visible when one of its source records is, and an object when one of its facts is.
// A fact a person told Mycel ("remember this") has no source records: it's visible to its teller
// alone, so to their own workflow runs, which read as them, and to no one else, admins included;
// once they delete it, to no one.
// Only confirmed entries count (`schema.ts`): what an email's sender wrote in its headers widens
// nothing. Group membership is never guessed: a group that isn't marked counts only through a
// copy in the viewer's own mailbox or Drive. Only the Workspace domain counts as the company's:
// a viewer's own address at another domain widens nothing. Admin rights widen nothing, and the
// system ctx (an org-credential run) is no one, so it sees only what's company-wide.
//
// The rule is SQL, so a search filters by it before it ranks or limits anything: facts the
// viewer can't see never crowd out the ones they can. A read resolves its Reading (who reads, and
// what's company-wide) once, with reads that don't grow with the org, and passes it down.
import { and, inArray, sql, type SQL } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { findUser, findUsersByEmail, getWorkspaceDomain } from "@/features/orgs/server";
import { type Ctx, isSystem } from "@/lib/ctx";
import { markedAddresses } from "./company-wide-lists";
import { facts, memoryObjects, sourceRecords } from "./schema";

/** Who is reading: a user, with their own address, or no one (the system ctx). */
export type Viewer = { userId: string | null; addresses: string[] };

export async function viewerOf(ctx: Ctx): Promise<Viewer> {
  if (isSystem(ctx)) return { userId: null, addresses: [] };
  const me = await findUser(ctx, ctx.userId);
  return { userId: ctx.userId, addresses: me === null ? [] : [me.email.toLowerCase()] };
}

/** What makes a source record company-wide in an org: its marked lists and Workspace domain. */
export type CompanyWide = { lists: string[]; domain: string };

/**
 * The org's company-wide lists and Workspace domain. A marked address that has since become a
 * person's own counts as theirs, not as a list's.
 */
export async function companyWideOf(ctx: Ctx): Promise<CompanyWide> {
  const [marked, domain] = await Promise.all([markedAddresses(ctx), getWorkspaceDomain(ctx)]);
  const people = new Set(
    (await findUsersByEmail(ctx, marked)).map((user) => user.email.toLowerCase()),
  );
  return {
    lists: marked.filter((address) => !people.has(address)),
    domain: domain.toLowerCase(),
  };
}

/** The viewer and the org's company-wide terms: everything the rule needs. */
export type Reading = { orgId: string; viewer: Viewer; companyWide: CompanyWide };

export async function readingOf(ctx: Ctx): Promise<Reading> {
  const [viewer, companyWide] = await Promise.all([viewerOf(ctx), companyWideOf(ctx)]);
  return { orgId: ctx.orgId, viewer, companyWide };
}

/** Which of the source records `ids` the reader may see. */
export async function visibleSourceRecords(
  ctx: Ctx,
  reading: Reading,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const records = await forOrg(ctx).select(sourceRecords, {
    columns: ["id"],
    where: and(inArray(sourceRecords.id, ids), recordVisible(reading, sql`${sourceRecords.id}`)),
  });
  return new Set(records.map((record) => record.id));
}

/**
 * SQL: whether the viewer may see the fact whose ID `factId` is: one of its sources is visible
 * to them, or they told it and haven't deleted it (a told fact has no sources, and only its
 * teller sees it).
 */
export function factVisible(reading: Reading, factId: SQL): SQL {
  const sourced = sql`exists (
    select 1 from fact_sources vis_fs
    where vis_fs.org_id = ${reading.orgId} and vis_fs.fact_id = ${factId}
      and ${recordVisible(reading, sql`vis_fs.source_record_id`)})`;
  const { userId } = reading.viewer;
  if (userId === null) return sourced;
  return sql`(${sourced} or exists (
    select 1 from facts vis_told
    where vis_told.org_id = ${reading.orgId} and vis_told.id = ${factId}
      and vis_told.told_by_user_id = ${userId} and vis_told.deleted_at is null))`;
}

/** SQL, on `facts`: whether the viewer may see the fact. */
export function visibleFact(reading: Reading): SQL {
  return factVisible(reading, sql`${facts.id}`);
}

/** SQL, on `memory_objects`: whether the viewer may see a fact about the object. */
export function visibleObject(reading: Reading): SQL {
  return sql`exists (
    select 1 from facts vis_f
    where vis_f.org_id = ${reading.orgId} and vis_f.subject_id = ${memoryObjects.id}
      and ${factVisible(reading, sql`vis_f.id`)})`;
}

/** SQL: whether the source record whose ID `recordId` is is company-wide. */
export function recordCompanyWide(orgId: string, terms: CompanyWide, recordId: SQL): SQL {
  const lists =
    terms.lists.length === 0
      ? sql`false`
      : sql`(vis_e.kind = 'address' and vis_e.value in (${sql.join(
          terms.lists.map((list) => sql`${list}`),
          sql`, `,
        )}))`;
  return sql`(
    exists (
      select 1 from source_records vis_org
      where vis_org.org_id = ${orgId} and vis_org.id = ${recordId} and vis_org.owner_scope = 'org')
    or exists (
      select 1 from access_list_entries vis_e
      where vis_e.org_id = ${orgId} and vis_e.source_record_id = ${recordId} and vis_e.confirmed
        and (vis_e.kind = 'anyone'
          or (vis_e.kind = 'domain' and vis_e.value = ${terms.domain})
          or ${lists})))`;
}

// SQL: whether the viewer may see the source record whose ID `recordId` is.
function recordVisible({ orgId, viewer, companyWide }: Reading, recordId: SQL): SQL {
  const held =
    viewer.userId === null
      ? sql`false`
      : sql`exists (
          select 1 from source_records vis_r
          join source_records vis_held
            on vis_held.org_id = vis_r.org_id
            and vis_held.app = vis_r.app
            and vis_held.item_key = vis_r.item_key
          where vis_r.org_id = ${orgId} and vis_r.id = ${recordId}
            and vis_held.owner_scope = 'member' and vis_held.owner_user_id = ${viewer.userId})`;
  const named =
    viewer.addresses.length === 0
      ? sql`false`
      : sql`exists (
          select 1 from access_list_entries vis_own
          where vis_own.org_id = ${orgId} and vis_own.source_record_id = ${recordId}
            and vis_own.confirmed and vis_own.kind = 'address'
            and vis_own.value in (${sql.join(
              viewer.addresses.map((address) => sql`${address}`),
              sql`, `,
            )}))`;
  return sql`(${recordCompanyWide(orgId, companyWide, recordId)} or ${held} or ${named})`;
}
