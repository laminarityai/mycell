// Learning what discovery stored, as memory's job would, and scripting the model calls that
// learning makes (classify, extraction, embeddings): for memory's tests, and for any feature's
// tests that read memory (workflows, the builder).
import { grantCredits } from "@/features/credits/server";
import {
  deleteRemovedItem,
  learnFromItem,
  rereadAccess,
  startMemory,
} from "@/features/memory/server";
import {
  changedItemSchema,
  itemToLearnSchema,
  removedItemSchema,
  type LearnOutcome,
} from "@/features/memory/types";
import { systemCtx } from "@/lib/ctx";
import { fakeAiGateway } from "./fake-ai-gateway";
import { fakeInngest } from "./fake-inngest";

// Event IDs name their connection, a fresh one in every test, so one set serves every test:
// the events learned from, and those followed.
const learned = new Set<string>();

const TO_LEARN = new Set(["discovery/item.stored", "memory/item.queued"]);
// Events sent without an ID (memory's own queued items) are told apart by when they were sent.
const seenWithoutId = new WeakSet<object>();

/**
 * Learns every item discovery announced, or memory queued, since the last call, in order, as
 * memory's job does: as the org's system ctx. Returns each item's outcome.
 */
export async function learnStoredItems(orgId: string): Promise<LearnOutcome[]> {
  const outcomes: LearnOutcome[] = [];
  for (const event of fakeInngest.sent()) {
    if (!TO_LEARN.has(event.name) || event.data.orgId !== orgId) continue;
    if (event.id === undefined) {
      if (seenWithoutId.has(event)) continue;
      seenWithoutId.add(event);
    } else {
      if (learned.has(event.id)) continue;
      learned.add(event.id);
    }
    outcomes.push(await learnFromItem(systemCtx(orgId), itemToLearnSchema.parse(event.data)));
  }
  return outcomes;
}

/**
 * Follows every item discovery found removed or changed since the last call, in order, as
 * memory's jobs do: as the org's system ctx.
 */
export async function followAppChanges(orgId: string): Promise<void> {
  for (const event of fakeInngest.sent()) {
    const key = event.id ?? JSON.stringify(event.data);
    if (learned.has(key) || event.data.orgId !== orgId) continue;
    if (event.name === "discovery/item.removed") {
      learned.add(key);
      await deleteRemovedItem(systemCtx(orgId), removedItemSchema.parse(event.data));
    } else if (event.name === "discovery/item.changed") {
      learned.add(key);
      await rereadAccess(systemCtx(orgId), changedItemSchema.parse(event.data));
    }
  }
}

/** Grants the org credits, without starting memory: it learns nothing yet. */
export async function grantOnly(orgId: string): Promise<void> {
  await grantCredits(systemCtx(orgId), 1000);
}

/** Grants the org credits, and starts memory with a budget it won't reach, as an admin would. */
export async function withCredits(orgId: string): Promise<void> {
  await grantOnly(orgId);
  await startMemory(systemCtx(orgId), { monthlyBudget: 1000 });
}

// The labels classify chooses from, for each kind of item.
const LABELS = {
  email: ["business", "newsletter", "marketing", "notification", "personal"],
  document: ["business", "personal", "template", "other"],
};

/**
 * The classify call's answer about an email (or a doc): Jev picks `label` (business, …), at the
 * cost the gateway reports, if any.
 */
export function classifiedAs(
  label: string,
  kind: keyof typeof LABELS = "email",
  options: { costUsd?: number } = {},
): void {
  // They sum to 1, as Jev's do.
  const others = LABELS[kind].length - 1;
  const probabilities = Object.fromEntries(
    LABELS[kind].map((other) => [other, other === label ? 1 - others * 0.02 : 0.02]),
  );
  fakeAiGateway.decision({ choice: label, probabilities }, options);
}

/** What the extraction model answers, in the shape memory's structured output asks for. */
export type ScriptedExtraction = {
  objects: {
    ref: string;
    kind: "person" | "company" | "deal" | "project" | "document";
    name: string;
    email?: string;
    domain?: string;
  }[];
  facts: {
    about: string;
    statement: string;
    evidence: string;
    predicate?: string;
    value?: string;
    object?: string;
    validFrom?: string;
    personal?: boolean;
  }[];
};

/**
 * Scripts one business email's learning: classify says business, the extraction answers
 * `extraction`, and the embedding answers one vector for each fact it keeps (`kept`, every fact
 * by default): `vectors` in order, or made-up ones.
 */
export function scriptLearning(
  extraction: ScriptedExtraction,
  kept = extraction.facts.length,
  vectors?: number[][],
) {
  classifiedAs("business");
  scriptExtraction(extraction, kept, vectors);
}

/** scriptLearning for a business doc. */
export function scriptDocLearning(extraction: ScriptedExtraction, kept = extraction.facts.length) {
  classifiedAs("business", "document");
  scriptExtraction(extraction, kept);
}

/** The extraction's answer and the embeddings of the facts it keeps, as for scriptLearning. */
export function scriptExtraction(
  extraction: ScriptedExtraction,
  kept = extraction.facts.length,
  vectors?: number[][],
) {
  fakeAiGateway.object({
    objects: extraction.objects.map((object) => ({
      email: null,
      domain: null,
      ...object,
    })),
    facts: extraction.facts.map(({ personal, ...fact }) => ({
      predicate: null,
      value: null,
      object: null,
      validFrom: null,
      ...fact,
      kind: personal === true ? "personal" : "work",
    })),
  });
  if (kept > 0) {
    fakeAiGateway.embeddings(vectors ?? Array.from({ length: kept }, (_, i) => vector(i + 1)));
  }
}

/** A vector of the `embed` role's 1536 dimensions. */
export function vector(seed: number): number[] {
  return Array.from({ length: 1536 }, (_, i) => ((seed * 31 + i) % 97) / 97);
}

/**
 * A 1536-dimension vector pointing mostly along `axis`, leaning `lean` of the way towards
 * `towards`: two facts on one axis mean nearly the same, two on different axes nothing alike.
 */
export function meaning(axis: number, towards = axis, lean = 0): number[] {
  return Array.from({ length: 1536 }, (_, i) => (i === axis ? 1 - lean : i === towards ? lean : 0));
}
