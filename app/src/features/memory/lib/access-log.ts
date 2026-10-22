// The access log (ADR-0024): every read of memory writes one entry saying who or what read,
// when, and which objects and facts, by ID only, never the query or what a fact says. Admins
// see their company's log; a member sees the entries that read a fact from their own sources
// (a source record their member connection holds, recorded when it was read). Entries are kept
// for ACCESS_LOG_RETENTION_DAYS.
import { randomUUID } from "node:crypto";
import { and, arrayContains, desc, eq, inArray, lt } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { userNames } from "@/features/orgs/server";
import type { Ctx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import {
  ACCESS_LOG_RETENTION_DAYS,
  type AccessLogEntry,
  type AccessLogReaderKind,
  type MemoryReader,
  type MemoryReadOperation,
} from "../types";
import {
  accessLogEntries,
  factSources,
  facts,
  memoryObjects,
  sourceRecords,
  staffConsents,
} from "./schema";
import { seenFacts } from "./visible-facts";
import { viewerOf } from "./visibility";

/** The most entries one listing returns, newest first. */
export const ACCESS_LOG_PAGE = 200;

/** Who or what a read is logged as. The ctx's user is the person whose view was read. */
export type LoggedReader = {
  kind: AccessLogReaderKind;
  runId?: string;
  workflowId?: string;
  staffConsentId?: string;
};

/** How a reader is logged: a person reading as the system ctx is Mycel itself. */
export function loggedReader(ctx: Ctx, reader: MemoryReader): LoggedReader {
  if (reader.kind === "workflow_run") {
    return { kind: "workflow_run", runId: reader.runId, workflowId: reader.workflowId };
  }
  if (reader.kind === "person" && ctx.role === "system") return { kind: "system" };
  return { kind: reader.kind };
}

/** Writes the entry for one read: what it returned, by ID. */
export async function logRead(
  ctx: Ctx,
  reader: LoggedReader,
  read: { operation: MemoryReadOperation; objectIds: string[]; factIds: string[] },
): Promise<void> {
  const db = forOrg(ctx);
  const factIds = [...new Set(read.factIds)];
  const links =
    factIds.length === 0
      ? []
      : await db.select(factSources, { where: inArray(factSources.factId, factIds) });
  const recordIds = [...new Set(links.map((link) => link.sourceRecordId))];
  const owned =
    recordIds.length === 0
      ? []
      : await db.select(sourceRecords, {
          where: and(inArray(sourceRecords.id, recordIds), eq(sourceRecords.ownerScope, "member")),
        });
  await db.insert(accessLogEntries, {
    id: randomUUID(),
    operation: read.operation,
    readerKind: reader.kind,
    userId: ctx.role === "system" ? null : ctx.userId,
    runId: reader.runId ?? null,
    workflowId: reader.workflowId ?? null,
    staffConsentId: reader.staffConsentId ?? null,
    objectIds: [...new Set(read.objectIds)],
    factIds,
    sourceOwnerIds: [...new Set(owned.map((record) => record.ownerUserId))],
  });
}

/**
 * The newest entries the caller may see: an admin, the company's; a member, those that read a
 * fact from their own sources. Each object's name shows only if the caller can see a fact about
 * it. The system ctx is no one, so it has no log to see.
 */
export async function listAccessLog(ctx: Ctx): Promise<AccessLogEntry[]> {
  if (ctx.role === "system") throw new ForbiddenError();
  const db = forOrg(ctx);
  const rows = await db.select(accessLogEntries, {
    where:
      ctx.role === "admin"
        ? undefined
        : arrayContains(accessLogEntries.sourceOwnerIds, [ctx.userId]),
    orderBy: [desc(accessLogEntries.readAt), desc(accessLogEntries.id)],
    limit: ACCESS_LOG_PAGE,
  });
  if (rows.length === 0) return [];

  const names = await userNames(ctx);
  const consentIds = [...new Set(rows.flatMap((row) => row.staffConsentId ?? []))];
  const consents =
    consentIds.length === 0
      ? []
      : await db.select(staffConsents, { where: inArray(staffConsents.id, consentIds) });
  const named = await objectNamesSeenBy(
    ctx,
    rows.flatMap((row) => row.factIds),
  );

  return rows.map((row) => {
    const consent = consents.find((candidate) => candidate.id === row.staffConsentId);
    return {
      id: row.id,
      readAt: row.readAt,
      operation: row.operation,
      reader: {
        kind: row.readerKind,
        userId: row.userId,
        name: row.userId === null ? null : names(row.userId),
        runId: row.runId,
        workflowId: row.workflowId,
        staff: consent === undefined ? null : { email: consent.staffEmail, reason: consent.reason },
      },
      objects: row.objectIds.map((id) => ({ id, name: named.get(id) ?? null })),
      factCount: row.factIds.length,
    };
  });
}

/**
 * The names of the objects the caller can see a fact about, among the facts with these IDs (a
 * fact's subject, and the object it links to), by ID.
 */
async function objectNamesSeenBy(ctx: Ctx, factIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(factIds)];
  if (ids.length === 0) return new Map();
  const db = forOrg(ctx);
  const rows = await db.select(facts, { where: inArray(facts.id, ids) });
  const seen = await seenFacts(ctx, await viewerOf(ctx), rows);
  const visible = [
    ...new Set(
      seen.flatMap(({ fact }) =>
        fact.objectId === null ? [fact.subjectId] : [fact.subjectId, fact.objectId],
      ),
    ),
  ];
  if (visible.length === 0) return new Map();
  const objects = await db.select(memoryObjects, { where: inArray(memoryObjects.id, visible) });
  return new Map(objects.map((object) => [object.id, object.name]));
}

/**
 * Deletes the entries older than ACCESS_LOG_RETENTION_DAYS before `now`, and the staff consents
 * that expired before then, which no entry still kept can name. The nightly job's, as the
 * org's system ctx.
 */
export async function pruneAccessLog(
  ctx: Ctx,
  now: Date = new Date(),
): Promise<{ entries: number; consents: number }> {
  if (ctx.role !== "system") throw new ForbiddenError();
  const cutoff = new Date(now.getTime() - ACCESS_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const db = forOrg(ctx);
  const entries = await db.delete(accessLogEntries, lt(accessLogEntries.readAt, cutoff));
  const consents = await db.delete(staffConsents, lt(staffConsents.expiresAt, cutoff));
  return { entries: entries.length, consents: consents.length };
}
