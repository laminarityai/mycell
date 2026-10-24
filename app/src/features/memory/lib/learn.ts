// Learning from one item discovery stored (a Gmail message or a Drive file version), or the
// Calendar poll found (a Calendar invite's version), as the org's
// system ctx (ADR-0009), in two steps. The first decides: nothing before an admin started
// memory, and nothing once the month's budget is spent (the item is postponed to next month);
// then learned already, not a kind memory reads (a Drive file that isn't a Google Doc, a Calendar
// event with no guests), changed since (a newer Drive or Calendar version is learned on its own),
// covered by an exclusion, sent by someone
// on the do-not-learn list (`forgotten`), a copy of an item another connection taught (linked
// to its facts there and then), or else, once the injection screen has passed it (an item it
// flags, or one nothing could screen, is skipped before any model reads it), whether it's
// business (`classify`). The second, for a business item, reads it again, checks the exclusions
// again (one added since may have had its forgetting run between the steps), extracts objects
// and facts, drops any object keyed by a forgotten address with the facts about it or linking
// to it, embeds the statements and stores them.
// Every model call is tagged `memory` in the ledger. The item's content is fetched inside each
// step and never leaves it (invariant 8): a step returns only what it decided. A connection or
// item that's gone ends learning quietly. An item learning can't pay for (the org is out of
// credits), or can't screen on the job's last attempt (the injection screen keeps failing), is
// postponed rather than lost, and learned again once credits are granted or the screen recovers.
import { sourceClient } from "@/features/connections/server";
import type { SourceClient } from "@/features/connections/types";
import { embed, screenForInjection } from "@/features/models/server";
import { InjectionScreenError } from "@/features/models/types";
import { getWorkspaceDomain } from "@/features/orgs/server";
import { type Ctx, requireSystem } from "@/lib/ctx";
import { OutOfCreditsError } from "@/lib/errors";
import { runInline, untilGone, type RunStep } from "@/lib/inngest";
import type { ItemToLearn, LearnOutcome, MemoryApp, PostponeReason } from "../types";
import { gate, MEMORY_USAGE, postpone } from "./budget";
import { readInvite } from "./calendar";
import { readDoc } from "./drive";
import { isExcluded } from "./exclusions";
import { extract, isBusiness } from "./extract";
import { forgottenAmong, withoutForgotten } from "./forget";
import { readEmail } from "./gmail";
import { matchObjects } from "./match";
import type { SourceItem } from "./source-item";
import { isKnown, retireOlderVersions, storeCopy, storeLearned, type Stored } from "./store";

const CONNECTION_FOREIGN_KEYS = [
  "source_records_connection_fk",
  "access_list_entries_connection_fk",
  "fact_sources_connection_fk",
  "memory_postponed_items_connection_fk",
];

// Whether an app's items can change between the two steps' reads. A Gmail message never
// changes, so the second step reads what the first one screened; a Drive doc or a Calendar
// invite can be edited at any moment, so the second step screens what it read again before a
// model reads it.
const CAN_CHANGE: Record<MemoryApp, boolean> = { gmail: false, drive: true, calendar: true };

type Unread = "gone" | "unsupported" | "outdated";

type Decision =
  | {
      decision:
        | Unread
        | "not_started"
        | "postponed"
        | "excluded"
        | "forgotten"
        | "known"
        | "flagged"
        | "unscreened"
        | "not_business"
        | "business";
    }
  | ({ decision: "copy" } & Stored);

/** How learning runs: `lastAttempt` when the job won't retry a failure again. */
export type LearnOptions = { lastAttempt?: boolean };

export async function learnFromItem(
  ctx: Ctx,
  item: ItemToLearn,
  runStep: RunStep = runInline,
  options: LearnOptions = {},
): Promise<LearnOutcome> {
  requireSystem(ctx);
  const guarded = <T extends { decision: string }>(work: () => Promise<T>) =>
    untilGone(CONNECTION_FOREIGN_KEYS, () => untilPostponed(ctx, item, options, work), {
      decision: "gone" as const,
    });
  const decided = await runStep("decide", () => guarded(() => decide(ctx, item)));
  switch (decided.decision) {
    case "gone":
      return { outcome: "gone" };
    case "not_started":
    case "postponed":
    case "excluded":
    case "forgotten":
    case "known":
    case "unsupported":
    case "outdated":
    case "flagged":
    case "unscreened":
    case "not_business":
      return { outcome: "skipped", reason: decided.decision };
    case "copy":
      return { outcome: "learned", objects: decided.objects, facts: decided.facts };
    case "business":
      break;
  }
  const learned = await runStep("extract", () => guarded(() => extractAndStore(ctx, item)));
  switch (learned.decision) {
    case "gone":
      return { outcome: "gone" };
    case "postponed":
    case "unsupported":
    case "outdated":
    case "excluded":
    case "flagged":
    case "unscreened":
    case "known":
    case "nothing_stated":
      return { outcome: "skipped", reason: learned.decision };
    case "stored":
      return { outcome: "learned", objects: learned.objects, facts: learned.facts };
  }
}

async function decide(ctx: Ctx, item: ItemToLearn): Promise<Decision> {
  // Not before an admin starts memory, nor once the month's budget is spent.
  const gated = await gate(ctx, item);
  if (gated !== "open") return { decision: gated };
  if (await isKnown(ctx, item.connectionId, item.app, item.sourceRef)) {
    return { decision: "known" };
  }
  const source = await read(ctx, item);
  if (typeof source === "string") return { decision: source };
  if (await isExcluded(ctx, source.client, source.item)) {
    // What its older versions taught goes too.
    await retireOlderVersions(ctx, source);
    return { decision: "excluded" };
  }
  if ((await forgottenAmong(ctx, source.item.senders)).size > 0) return { decision: "forgotten" };
  const copy = await storeCopy(ctx, source);
  if (copy !== null) return { decision: "copy", ...copy };
  // Before any model reads it.
  const screened = await screen(ctx, source.item);
  const decision = screened ?? ((await isBusiness(ctx, source.item)) ? "business" : "not_business");
  // What a newer version no longer teaches goes, whatever this one teaches.
  if (decision !== "business") await retireOlderVersions(ctx, source);
  return { decision };
}

type Learned =
  | { decision: Unread | "excluded" | "flagged" | "unscreened" | "known" | "nothing_stated" }
  | ({ decision: "stored" } & Stored);

async function extractAndStore(ctx: Ctx, item: ItemToLearn): Promise<Learned> {
  const source = await read(ctx, item);
  if (typeof source === "string") return { decision: source };
  // Again: an exclusion added since the first step, whose job may have run between the two
  // steps and found nothing learned yet, keeps the item out.
  if (await isExcluded(ctx, source.client, source.item)) {
    await retireOlderVersions(ctx, source);
    return { decision: "excluded" };
  }
  if (CAN_CHANGE[item.app]) {
    const screened = await screen(ctx, source.item);
    if (screened !== null) {
      await retireOlderVersions(ctx, source);
      return { decision: screened };
    }
  }
  const extracted = await withoutForgotten(
    ctx,
    await extract(ctx, source.item, await getWorkspaceDomain(ctx)),
  );
  if (extracted.facts.length === 0) {
    await retireOlderVersions(ctx, source);
    return { decision: "nothing_stated" };
  }
  const { output: embeddings } = await embed(ctx, {
    values: extracted.facts.map((fact) => fact.statement),
    ...MEMORY_USAGE,
  });
  const matches = await matchObjects(ctx, extracted, embeddings);
  const stored = await storeLearned(ctx, source, extracted, embeddings, matches);
  return stored === null ? { decision: "known" } : { decision: "stored", ...stored };
}

// The injection screen's verdict on the item: null when it passed.
async function screen(ctx: Ctx, item: SourceItem): Promise<"flagged" | "unscreened" | null> {
  const { verdict } = await screenForInjection(ctx, { text: item.text, ...MEMORY_USAGE });
  if (verdict === "flagged") return "flagged";
  if (verdict === "unavailable") return "unscreened";
  return null;
}

// The item, and the connection's source it was read through: its access checked once a step,
// and every later call to its app in the step (an exclusion's labels or folders) made through it.
type Source = {
  client: SourceClient;
  connection: SourceClient["connection"];
  app: MemoryApp;
  item: SourceItem;
};

async function read(ctx: Ctx, item: ItemToLearn): Promise<Source | Unread> {
  const client = await sourceClient(ctx, item.connectionId);
  const read =
    item.app === "drive"
      ? await readDoc(ctx, client, item.sourceRef)
      : item.app === "calendar"
        ? await readInvite(client, item.sourceRef)
        : ((await readEmail(client, item.sourceRef)) ?? "gone");
  return typeof read === "string"
    ? read
    : { client, connection: client.connection, app: item.app, item: read };
}

// Postponing the item, rather than failing, when learning can't pay for it or (on the job's last
// attempt) can't screen it.
async function untilPostponed<T extends { decision: string }>(
  ctx: Ctx,
  item: ItemToLearn,
  options: LearnOptions,
  work: () => Promise<T>,
): Promise<T | { decision: "postponed" }> {
  try {
    return await work();
  } catch (error) {
    const reason: PostponeReason | null =
      error instanceof OutOfCreditsError
        ? "credits"
        : error instanceof InjectionScreenError && options.lastAttempt === true
          ? "screen"
          : null;
    if (reason === null) throw error;
    await postpone(ctx, item, reason);
    return { decision: "postponed" };
  }
}
