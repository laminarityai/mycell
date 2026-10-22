// Learning from one item discovery stored, as the org's system ctx (ADR-0009), in two steps.
// The first reads the item and decides: learned already, a copy of an item another mailbox
// taught (linked to its facts there and then), or else, once the injection screen has passed it
// (an item it flags, or one nothing could screen, is skipped before any model reads it),
// whether it's business (`classify`). The
// second, for business mail, reads it again, extracts objects and facts, embeds the
// statements and stores them. The item's content is fetched inside each step and never leaves
// it (invariant 8): a step returns only what it decided. A connection or item that's gone ends
// learning quietly.
import { isForeignKeyViolation } from "@/db/errors";
import { getConnection } from "@/features/connections/server";
import { embed, screenForInjection } from "@/features/models/server";
import { getWorkspaceDomain } from "@/features/orgs/server";
import type { Ctx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { ItemToLearn, LearnOutcome } from "../types";
import { extract, isBusiness } from "./extract";
import { readEmail, type EmailToLearn } from "./gmail";
import { isKnown, storeCopy, storeLearned, type Stored } from "./store";

/** A step result: JSON, since Inngest stores it and replays it instead of re-running. */
type StepResult = Record<string, string | number | boolean | null>;

/** Runs one named step: Inngest's `step.run` in the job, called straight through elsewhere. */
export type RunStep = <T extends StepResult>(id: string, run: () => Promise<T>) => Promise<T>;

const runInline: RunStep = (_id, run) => run();

const CONNECTION_FOREIGN_KEYS = [
  "source_records_connection_fk",
  "access_list_entries_connection_fk",
  "fact_sources_connection_fk",
];

type Decision =
  | { decision: "gone" | "known" | "flagged" | "unscreened" | "not_business" | "business" }
  | ({ decision: "copy" } & Stored);

export async function learnFromItem(
  ctx: Ctx,
  item: ItemToLearn,
  runStep: RunStep = runInline,
): Promise<LearnOutcome> {
  if (ctx.role !== "system") throw new ForbiddenError();
  const decided = await runStep("decide", () => untilGone(() => decide(ctx, item)));
  switch (decided.decision) {
    case "gone":
      return { outcome: "gone" };
    case "known":
    case "flagged":
    case "unscreened":
    case "not_business":
      return { outcome: "skipped", reason: decided.decision };
    case "copy":
      return { outcome: "learned", objects: decided.objects, facts: decided.facts };
    case "business":
      break;
  }
  const learned = await runStep("extract", () => untilGone(() => extractAndStore(ctx, item)));
  switch (learned.decision) {
    case "gone":
      return { outcome: "gone" };
    case "known":
    case "nothing_stated":
      return { outcome: "skipped", reason: learned.decision };
    case "stored":
      return { outcome: "learned", objects: learned.objects, facts: learned.facts };
  }
}

async function decide(ctx: Ctx, item: ItemToLearn): Promise<Decision> {
  if (await isKnown(ctx, item.connectionId, item.app, item.sourceRef)) {
    return { decision: "known" };
  }
  const source = await read(ctx, item);
  if (source === null) return { decision: "gone" };
  const copy = await storeCopy(ctx, source);
  if (copy !== null) return { decision: "copy", ...copy };
  // Before any model reads it. Gmail never changes a message, so step two reads what this saw.
  const { verdict } = await screenForInjection(ctx, { text: source.email.text });
  if (verdict === "flagged") return { decision: "flagged" };
  if (verdict === "unavailable") return { decision: "unscreened" };
  return { decision: (await isBusiness(ctx, source.email)) ? "business" : "not_business" };
}

type Learned =
  { decision: "gone" | "known" | "nothing_stated" } | ({ decision: "stored" } & Stored);

async function extractAndStore(ctx: Ctx, item: ItemToLearn): Promise<Learned> {
  const source = await read(ctx, item);
  if (source === null) return { decision: "gone" };
  const extracted = await extract(ctx, source.email, await getWorkspaceDomain(ctx));
  if (extracted.facts.length === 0) return { decision: "nothing_stated" };
  const { output: embeddings } = await embed(ctx, {
    values: extracted.facts.map((fact) => fact.statement),
  });
  const stored = await storeLearned(ctx, source, extracted, embeddings);
  return stored === null ? { decision: "known" } : { decision: "stored", ...stored };
}

async function read(ctx: Ctx, item: ItemToLearn) {
  const connection = await getConnection(ctx, item.connectionId);
  const email: EmailToLearn | null = await readEmail(ctx, connection.id, item.sourceRef);
  return email === null ? null : { connection, app: item.app, email };
}

// "The connection is gone" as a decision rather than an error: a missing connection is
// NotFoundError, and a write for a deleted one breaks its foreign key.
async function untilGone<T extends { decision: string }>(
  work: () => Promise<T>,
): Promise<T | { decision: "gone" }> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof NotFoundError) return { decision: "gone" };
    if (CONNECTION_FOREIGN_KEYS.some((name) => isForeignKeyViolation(error, name))) {
      return { decision: "gone" };
    }
    throw error;
  }
}
