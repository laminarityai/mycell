// Shared by memory's tests: learning what discovery stored, as memory's job would, and scripting
// the model calls that learning makes (classify, extraction, embeddings).
import { grantCredits } from "@/features/credits/server";
import { systemCtx } from "@/lib/ctx";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { fakeInngest } from "@/testing/fake-inngest";
import { learnFromItem, startMemory } from "../server";
import { itemToLearnSchema, type LearnOutcome } from "../types";

// Event IDs name their connection, a fresh one in every test, so one set serves every test.
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

/** Grants the org credits, without starting memory: it learns nothing yet. */
export async function grantOnly(orgId: string): Promise<void> {
  await grantCredits(systemCtx(orgId), 1000);
}

/** Grants the org credits, and starts memory with a budget it won't reach, as an admin would. */
export async function withCredits(orgId: string): Promise<void> {
  await grantOnly(orgId);
  await startMemory(systemCtx(orgId), { monthlyBudget: 1000 });
}

const LABELS = ["business", "newsletter", "marketing", "notification", "personal"];

/** The classify call's answer: Jev picks `label` (business, newsletter, …). */
export function classifiedAs(label: string, options: { costUsd?: number } = {}): void {
  const probabilities = Object.fromEntries(
    LABELS.map((other) => [other, other === label ? 0.92 : 0.02]),
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
