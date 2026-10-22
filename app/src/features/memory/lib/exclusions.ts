// Exclusions (ADR-0023): what an admin keeps out of memory for the whole company. Learning skips
// an item one covers before any model reads it, and adding one forgets what memory already
// learned from the items it covers: their source records are deleted, and the database's
// triggers remove each fact left with no source, and each object left with no fact (migration
// 0026). A fact another item still supports stays.
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, like, or, type SQL } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { listConnectionsForJobs } from "@/features/connections/server";
import { type Ctx, requireRole, requireSystem } from "@/lib/ctx";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type { RunStep } from "@/lib/inngest";
import { exclusionInputSchema, type Exclusion, type ExclusionInput } from "../types";
import { sendExclusionAdded } from "./events";
import { folderedRecords, inFolders, labelledRecords, labelNames } from "./excluded-items";
import { accessListEntries, exclusions, sourceRecords } from "./schema";
import type { SourceItem } from "./source-item";

/** The org's exclusions, oldest first. Admins (and jobs) only. */
export async function listExclusions(ctx: Ctx): Promise<Exclusion[]> {
  requireRole(ctx, "admin", "system");
  const rows = await forOrg(ctx).select(exclusions, {
    orderBy: [asc(exclusions.createdAt), asc(exclusions.id)],
  });
  return rows.map(({ id, kind, value, createdAt }) => ({ id, kind, value, createdAt }));
}

/** Adds an exclusion, and starts forgetting what memory learned from the items it covers. */
export async function addExclusion(ctx: Ctx, input: ExclusionInput): Promise<Exclusion> {
  requireRole(ctx, "admin", "system");
  const parsed = exclusionInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "That can't be excluded.");
  }
  const { kind, value } = parsed.data;
  const existing = await listExclusions(ctx);
  // Gmail matches label names regardless of case, so "HR" and "hr" are one exclusion.
  if (existing.some((e) => e.kind === kind && e.value.toLowerCase() === value.toLowerCase())) {
    throw new ConflictError("That's excluded already.");
  }
  const inserted = await forOrg(ctx).insert(
    exclusions,
    { id: randomUUID(), kind, value },
    { onConflictDoNothing: true },
  );
  const row = inserted.at(0);
  if (row === undefined) throw new ConflictError("That's excluded already.");
  await sendExclusionAdded(ctx.orgId, row.id);
  return { id: row.id, kind: row.kind, value: row.value, createdAt: row.createdAt };
}

/**
 * Removes an exclusion: items stored from now on are learned again. What it kept out before
 * stays unlearned.
 */
export async function removeExclusion(ctx: Ctx, exclusionId: string): Promise<void> {
  requireRole(ctx, "admin", "system");
  const deleted = await forOrg(ctx).delete(exclusions, eq(exclusions.id, exclusionId));
  if (deleted.length === 0) throw new NotFoundError("exclusion");
}

/**
 * Whether an exclusion covers the item, read from `connectionId`: an address on it (an email's
 * From, To, Cc or Bcc; a doc's sharing list), or one at an excluded domain; an email's label;
 * or a doc's folder, or one it's under.
 */
export async function isExcluded(
  ctx: Ctx,
  connectionId: string,
  item: SourceItem,
): Promise<boolean> {
  const all = await listExclusions(ctx);
  const addresses = [
    ...item.addresses,
    ...item.access.flatMap((entry) => (entry.kind === "address" ? [entry.value] : [])),
  ];
  if (all.some((exclusion) => coversAddresses(exclusion, addresses))) return true;
  const values = (kind: Exclusion["kind"]) =>
    all.filter((exclusion) => exclusion.kind === kind).map((exclusion) => exclusion.value);
  const labels = values("gmail_label");
  if (labels.length > 0 && item.labelIds !== undefined && item.labelIds.length > 0) {
    const names = await labelNames(ctx, connectionId, item.labelIds);
    if (labels.some((label) => names.has(label.toLowerCase()))) return true;
  }
  const folders = values("drive_folder");
  if (folders.length > 0 && item.parentIds !== undefined) {
    return inFolders(ctx, connectionId, item.parentIds, folders);
  }
  return false;
}

function coversAddresses(exclusion: Exclusion, addresses: string[]): boolean {
  if (exclusion.kind === "address") return addresses.includes(exclusion.value);
  if (exclusion.kind !== "domain") return false;
  return addresses.some((address) => inDomain(address.split("@").at(-1) ?? "", exclusion.value));
}

// The domain itself or one under it: mail.acme.com is in acme.com.
function inDomain(domain: string, excluded: string): boolean {
  return domain === excluded || domain.endsWith(`.${excluded}`);
}

/**
 * Forgets what memory learned from the items an exclusion covers: for a label or a folder, a
 * connection a step. Returns how many source records went. An exclusion removed meanwhile
 * forgets nothing.
 */
export async function forgetExcluded(
  ctx: Ctx,
  exclusionId: string,
  runStep: RunStep,
): Promise<{ sourceRecords: number }> {
  requireSystem(ctx);
  const exclusion = (await listExclusions(ctx)).find((e) => e.id === exclusionId);
  if (exclusion === undefined) return { sourceRecords: 0 };
  if (exclusion.kind === "address" || exclusion.kind === "domain") {
    const done = await runStep("forget", () => forgetAddressed(ctx, exclusion));
    return { sourceRecords: done.deleted };
  }
  const recordsOf = exclusion.kind === "gmail_label" ? labelledRecords : folderedRecords;
  let deleted = 0;
  for (const connection of await listConnectionsForJobs(ctx)) {
    const done = await runStep(`forget-${connection.id}`, async () => ({
      deleted: await deleteRecords(ctx, await recordsOf(ctx, connection.id, exclusion.value)),
    }));
    deleted += done.deleted;
  }
  return { sourceRecords: deleted };
}

// Every source record whose access list names the address, or an address at the domain.
async function forgetAddressed(ctx: Ctx, exclusion: Exclusion): Promise<{ deleted: number }> {
  const db = forOrg(ctx);
  const value = exclusion.value;
  const match: SQL | undefined =
    exclusion.kind === "address"
      ? eq(accessListEntries.value, value)
      : or(
          like(accessListEntries.value, `%@${value}`),
          like(accessListEntries.value, `%.${value}`),
        );
  const entries = await db.select(accessListEntries, {
    where: and(eq(accessListEntries.kind, "address"), match),
  });
  // `like` treats _ as a wildcard; check each match exactly.
  const ids = entries
    .filter((entry) => coversAddresses(exclusion, [entry.value]))
    .map((entry) => entry.sourceRecordId);
  return { deleted: await deleteRecords(ctx, ids) };
}

async function deleteRecords(ctx: Ctx, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const deleted = await forOrg(ctx).delete(
    sourceRecords,
    inArray(sourceRecords.id, [...new Set(ids)]),
  );
  return deleted.length;
}
