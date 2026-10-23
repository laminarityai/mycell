// How long memory keeps things (ADR-0024): a source record goes once the item it points at is
// older than the org's retention window (24 months by default, which admins may shorten), and
// with it what only it taught. Each night, as the org's system ctx, `applyRetention` deletes the
// records past the window; the cascade and migrations 0026 and 0032's triggers then remove each
// fact left with no source (superseded history included, relinking what's left) and each object
// left with no fact. It then sweeps for any such fact or object still left, so nothing outlives
// its sources. A fact a person told Mycel (`told_by`, M9) has no source, and stays.
import { and, eq, lt, sql } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { type Ctx, requireAdmin, requireSystem } from "@/lib/ctx";
import { ConflictError, ValidationError } from "@/lib/errors";
import {
  MAX_RETENTION_MONTHS,
  retentionWindowSchema,
  type RetentionApplied,
  type RetentionWindow,
} from "../types";
import { settingsOf } from "./budget";
import { factSources, facts, memoryObjects, memorySettings, sourceRecords } from "./schema";

/** Sets the retention window, in whole months; the next night's run applies it. Admins only. */
export async function setRetentionWindow(ctx: Ctx, input: RetentionWindow): Promise<void> {
  requireAdmin(ctx);
  const parsed = retentionWindowSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      `Memory keeps things for 1 to ${String(MAX_RETENTION_MONTHS)} whole months.`,
    );
  }
  const updated = await forOrg(ctx).update(memorySettings, {
    retentionMonths: parsed.data.months,
    updatedAt: new Date(),
  });
  if (updated.length === 0) throw new ConflictError("Memory hasn't started yet.");
}

/**
 * The moment `months` calendar months (UTC) before `now`: an item that occurred before it is
 * past the window. A day the earlier month lacks becomes its last day (31 March less a month is
 * the last day of February).
 */
export function retentionCutoff(months: number, now = new Date()): Date {
  const month = now.getUTCMonth() - months;
  const lastDay = new Date(Date.UTC(now.getUTCFullYear(), month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      month,
      Math.min(now.getUTCDate(), lastDay),
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds(),
      now.getUTCMilliseconds(),
    ),
  );
}

/**
 * Deletes the org's source records past its retention window, and every fact and object they
 * leave unsupported. Returns how many of each went. The org's system ctx only.
 */
export async function applyRetention(ctx: Ctx): Promise<RetentionApplied> {
  requireSystem(ctx);
  const db = forOrg(ctx);
  const months = (await settingsOf(ctx))?.retentionMonths ?? MAX_RETENTION_MONTHS;
  const before = { facts: await db.count(facts), objects: await db.count(memoryObjects) };
  const records = await db.deleteCount(
    sourceRecords,
    lt(sourceRecords.occurredAt, retentionCutoff(months)),
  );
  // What the triggers left: a learned fact with no source, an object with no fact.
  await db.deleteCount(
    facts,
    and(
      eq(facts.origin, "source"),
      sql`not exists (select 1 from ${factSources} where ${factSources.factId} = ${facts.id})`,
    ),
  );
  await db.deleteCount(
    memoryObjects,
    sql`not exists (select 1 from ${facts} where ${facts.subjectId} = ${memoryObjects.id} or ${facts.objectId} = ${memoryObjects.id})`,
  );
  return {
    sourceRecords: records,
    facts: before.facts - (await db.count(facts)),
    objects: before.objects - (await db.count(memoryObjects)),
  };
}
