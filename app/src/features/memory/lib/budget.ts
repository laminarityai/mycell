// What memory costs, and the admin's control of it (ADR-0022): nothing is learned until an admin
// has seen the estimate, made from the items discovery stored, and started memory with a
// monthly budget. Every model call learning makes is tagged `memory` in the ledger, and once a
// calendar month's (UTC) tagged spending reaches the budget, each item is postponed until the
// next month starts, or the budget changes. The budget caps learning only: a person's summaries
// are tagged `memory_summary`, so they neither count toward it nor wait on it.
import { and, inArray, lte, sql } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { getSpending } from "@/features/credits/server";
import { countStoredItems, listStoredItems } from "@/features/discovery/server";
import { CREDIT_ESTIMATES, estimateScreenCredits } from "@/features/models/server";
import { type Ctx, requireRole, requireSystem } from "@/lib/ctx";
import { ConflictError, ValidationError } from "@/lib/errors";
import type { RunStep } from "@/lib/inngest";
import {
  memoryBudgetSchema,
  POSTPONE_REASONS,
  type ItemToLearn,
  type MemoryBudget,
  type MemoryEstimate,
  type PostponeReason,
} from "../types";
import { MAX_INVITE_CHARS } from "./calendar";
import { sendItemsQueued, sendMemoryStarted, sendPostponedDue } from "./events";
import { GOOGLE_DOC, MAX_DOC_CHARS } from "./drive";
import { MAX_TEXT_CHARS } from "./gmail";
import { memorySettings, postponedItems } from "./schema";

/** What memory's ledger entries are tagged with: pass it to every model call learning makes. */
export const MEMORY_USAGE = { purpose: "memory" } as const;

/** The start of this calendar month, UTC: when this month's budget began. */
export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

// What memory learns from of what discovery stored: emails, and Google Docs (every version).
const LEARNABLE = { driveMimeType: GOOGLE_DOC };

/**
 * The most learning one item costs: two injection screens (a doc or an invite is screened again
 * before extraction, since it can change) of the longest text memory reads, `classify`,
 * extraction and embedding.
 */
export function creditsPerItem(): number {
  return (
    2 * estimateScreenCredits(Math.max(MAX_TEXT_CHARS, MAX_DOC_CHARS, MAX_INVITE_CHARS)) +
    CREDIT_ESTIMATES.classify +
    CREDIT_ESTIMATES.fast +
    CREDIT_ESTIMATES.embed
  );
}

export async function estimate(ctx: Ctx): Promise<MemoryEstimate> {
  const items = await countStoredItems(ctx, LEARNABLE);
  const perItem = creditsPerItem();
  return { items, creditsPerItem: perItem, credits: items * perItem };
}

/**
 * Whether an admin has started memory in the org: the Calendar poll then reads every calendar
 * for memory (ADR-0029). Jobs only.
 */
export async function hasMemoryStarted(ctx: Ctx): Promise<boolean> {
  requireSystem(ctx);
  return (await forOrg(ctx).count(memorySettings)) > 0;
}

export async function settingsOf(ctx: Ctx) {
  const rows = await forOrg(ctx).select(memorySettings);
  return rows.at(0) ?? null;
}

export async function spentThisMonth(ctx: Ctx): Promise<number> {
  return getSpending(ctx, { purpose: "memory", since: monthStart() });
}

/**
 * Starts memory with a monthly budget, once an admin has seen the estimate: what discovery has
 * stored so far is queued for learning, and new items are learned as they're stored.
 */
export async function startMemory(ctx: Ctx, input: MemoryBudget): Promise<void> {
  requireRole(ctx, "admin", "system");
  const monthlyBudget = budgetOf(input);
  const inserted = await forOrg(ctx).insert(
    memorySettings,
    { monthlyBudget, startedAt: new Date(), startedByUserId: ctx.userId },
    { onConflictDoNothing: true },
  );
  if (inserted.length === 0) throw new ConflictError("Memory has already started.");
  await sendMemoryStarted(ctx.orgId);
}

/** Changes the monthly budget. Items postponed under the old one are tried again. */
export async function setMemoryBudget(ctx: Ctx, input: MemoryBudget): Promise<void> {
  requireRole(ctx, "admin", "system");
  const monthlyBudget = budgetOf(input);
  const updated = await forOrg(ctx).update(memorySettings, {
    monthlyBudget,
    updatedAt: new Date(),
  });
  if (updated.length === 0) throw new ConflictError("Memory hasn't started yet.");
  await sendPostponedDue([ctx.orgId]);
}

function budgetOf(input: MemoryBudget): number {
  const parsed = memoryBudgetSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("A budget is a positive number of credits.");
  return parsed.data.monthlyBudget;
}

/**
 * Whether learning may spend now: not before memory started, and not once this month's
 * spending reached the budget, when the item is postponed.
 */
export async function gate(
  ctx: Ctx,
  item: ItemToLearn,
): Promise<"open" | "not_started" | "postponed"> {
  const settings = await settingsOf(ctx);
  if (settings === null) return "not_started";
  if ((await spentThisMonth(ctx)) < settings.monthlyBudget) return "open";
  await postpone(ctx, item, "budget");
  return "postponed";
}

/** Puts the item off until what stopped it is resolved (`resumePostponed`). */
export async function postpone(ctx: Ctx, item: ItemToLearn, reason: PostponeReason): Promise<void> {
  const { connectionId, app, sourceRef } = item;
  await forOrg(ctx).insert(
    postponedItems,
    { connectionId, app, sourceRef, reason },
    { onConflictDoNothing: true },
  );
}

const PAGE = 1000;

/**
 * Queues every item discovery stored for learning, a page a step: what memory's start job
 * runs. Items learned already are skipped when they're learned.
 */
export async function queueStoredItems(ctx: Ctx, runStep: RunStep): Promise<{ queued: number }> {
  requireSystem(ctx);
  let after: string | null = null;
  let queued = 0;
  for (let page = 0; ; page += 1) {
    const from: string | null = after;
    const done = await runStep(`queue-${String(page)}`, async () => {
      const { items, next } = await listStoredItems(ctx, {
        ...(from === null ? {} : { after: from }),
        ...LEARNABLE,
        limit: PAGE,
      });
      await sendItemsQueued(ctx.orgId, items, "memory-start");
      return { next, count: items.length };
    });
    queued += done.count;
    if (done.next === null) return { queued };
    after = done.next;
  }
}

/**
 * Queues the items postponed for `reasons` (every reason by default) again, and forgets they
 * were postponed. One still stopped is postponed again when it's learned, so only those
 * postponed before this began are taken.
 */
export async function resumePostponed(
  ctx: Ctx,
  reasons: readonly PostponeReason[] = POSTPONE_REASONS,
): Promise<{ queued: number }> {
  requireSystem(ctx);
  const db = forOrg(ctx);
  const began = new Date();
  let queued = 0;
  for (;;) {
    const items = await db.select(postponedItems, {
      where: and(
        lte(postponedItems.postponedAt, began),
        inArray(postponedItems.reason, [...reasons]),
      ),
      limit: PAGE,
    });
    if (items.length === 0) return { queued };
    const keys = items.map((item) => sql`(${item.connectionId}, ${item.app}, ${item.sourceRef})`);
    await db.delete(
      postponedItems,
      sql`(${postponedItems.connectionId}, ${postponedItems.app}, ${postponedItems.sourceRef}) in (${sql.join(keys, sql`, `)})`,
    );
    await sendItemsQueued(
      ctx.orgId,
      items.map(({ connectionId, app, sourceRef }) => ({ connectionId, app, sourceRef })),
    );
    queued += items.length;
  }
}

/** How many items wait to be learned: for the budget, credits or the injection screen. */
export async function countPostponed(ctx: Ctx): Promise<number> {
  return forOrg(ctx).count(postponedItems);
}
