// Exclusions (ADR-0023): what an admin keeps out of memory for the whole company. Learning skips
// an item one covers before any model reads it, and adding one forgets what memory already
// learned from the items it covers: their source records are deleted, and the database's
// triggers remove each fact left with no source, and each object left with no fact (migration
// 0026). A fact another item still supports stays. Drive folders are kept for when memory learns
// from Drive.
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, like, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { forOrg } from "@/db/for-org";
import { listConnectionsForJobs, proxyGet } from "@/features/connections/server";
import type { Ctx } from "@/lib/ctx";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { exclusionInputSchema, type Exclusion, type ExclusionInput } from "../types";
import { sendExclusionAdded } from "./events";
import type { EmailToLearn } from "./gmail";
import { accessListEntries, exclusions, sourceRecords } from "./schema";

const GMAIL = "/gmail/v1/users/me";

/** The org's exclusions, oldest first. Admins (and jobs) only. */
export async function listExclusions(ctx: Ctx): Promise<Exclusion[]> {
  if (ctx.role === "member") throw new ForbiddenError();
  const rows = await forOrg(ctx).select(exclusions, {
    orderBy: [asc(exclusions.createdAt), asc(exclusions.id)],
  });
  return rows.map(({ id, kind, value, createdAt }) => ({ id, kind, value, createdAt }));
}

/** Adds an exclusion, and starts forgetting what memory learned from the items it covers. */
export async function addExclusion(ctx: Ctx, input: ExclusionInput): Promise<Exclusion> {
  if (ctx.role === "member") throw new ForbiddenError();
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
  if (ctx.role === "member") throw new ForbiddenError();
  const deleted = await forOrg(ctx).delete(exclusions, eq(exclusions.id, exclusionId));
  if (deleted.length === 0) throw new NotFoundError("exclusion");
}

/** Whether an exclusion covers the email, read from `connectionId`. */
export async function isExcluded(
  ctx: Ctx,
  connectionId: string,
  email: EmailToLearn,
): Promise<boolean> {
  const all = await listExclusions(ctx);
  if (all.some((exclusion) => coversAddresses(exclusion, email.addresses))) return true;
  const labels = all.filter((exclusion) => exclusion.kind === "gmail_label");
  if (labels.length === 0 || email.labelIds.length === 0) return false;
  const names = new Set(
    (await labelsOf(ctx, connectionId))
      .filter((label) => email.labelIds.includes(label.id))
      .map((label) => label.name.toLowerCase()),
  );
  return labels.some((label) => names.has(label.value.toLowerCase()));
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
 * Forgets what memory learned from the items an exclusion covers, a connection a step for a
 * label. Returns how many source records went. An exclusion removed meanwhile forgets nothing.
 */
export async function forgetExcluded(
  ctx: Ctx,
  exclusionId: string,
  runStep: <T extends Record<string, number>>(id: string, run: () => Promise<T>) => Promise<T>,
): Promise<{ sourceRecords: number }> {
  if (ctx.role !== "system") throw new ForbiddenError();
  const exclusion = (await listExclusions(ctx)).find((e) => e.id === exclusionId);
  if (exclusion === undefined) return { sourceRecords: 0 };
  switch (exclusion.kind) {
    case "address":
    case "domain": {
      const done = await runStep("forget", () => forgetAddressed(ctx, exclusion));
      return { sourceRecords: done.deleted };
    }
    case "gmail_label": {
      let deleted = 0;
      for (const connection of await listConnectionsForJobs(ctx)) {
        const done = await runStep(`forget-${connection.id}`, () =>
          forgetLabelled(ctx, connection.id, exclusion.value),
        );
        deleted += done.deleted;
      }
      return { sourceRecords: deleted };
    }
    case "drive_folder":
      return { sourceRecords: 0 };
  }
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

const labelsSchema = z.object({
  labels: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
});

const messageListSchema = z.object({
  messages: z.array(z.object({ id: z.string() })).default([]),
  nextPageToken: z.string().optional(),
});

async function labelsOf(ctx: Ctx, connectionId: string) {
  return (await proxyGet(ctx, connectionId, `${GMAIL}/labels`, labelsSchema))?.labels ?? [];
}

// The connection's learned emails with the label (by name) now.
async function forgetLabelled(
  ctx: Ctx,
  connectionId: string,
  name: string,
): Promise<{ deleted: number }> {
  const db = forOrg(ctx);
  const learned = await db.count(sourceRecords, eq(sourceRecords.connectionId, connectionId));
  if (learned === 0) return { deleted: 0 };
  const label = (await labelsOf(ctx, connectionId)).find(
    (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
  );
  if (label === undefined) return { deleted: 0 };
  let deleted = 0;
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({
      labelIds: label.id,
      maxResults: "500",
      includeSpamTrash: "true",
      ...(pageToken === undefined ? {} : { pageToken }),
    });
    const page = await proxyGet(ctx, connectionId, `${GMAIL}/messages?${query}`, messageListSchema);
    if (page === null || page.messages.length === 0) break;
    const records = await db.select(sourceRecords, {
      where: and(
        eq(sourceRecords.connectionId, connectionId),
        eq(sourceRecords.app, "gmail"),
        inArray(
          sourceRecords.sourceRef,
          page.messages.map((message) => message.id),
        ),
      ),
    });
    deleted += await deleteRecords(
      ctx,
      records.map((record) => record.id),
    );
    pageToken = page.nextPageToken;
  } while (pageToken !== undefined);
  return { deleted };
}

async function deleteRecords(ctx: Ctx, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const deleted = await forOrg(ctx).delete(
    sourceRecords,
    inArray(sourceRecords.id, [...new Set(ids)]),
  );
  return deleted.length;
}
