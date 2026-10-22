// Shared by memory's tests: learning what discovery stored, as memory's job would, and scripting
// the model calls that learning makes (classify, extraction, embeddings).
import { grantCredits } from "@/features/credits/server";
import { systemCtx } from "@/lib/ctx";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { fakeInngest } from "@/testing/fake-inngest";
import { learnFromItem } from "../server";
import { itemToLearnSchema, type LearnOutcome } from "../types";

// Event IDs name their connection, a fresh one in every test, so one set serves every test.
const learned = new Set<string>();

/**
 * Learns every item discovery announced since the last call, in order, as memory's job does:
 * as the org's system ctx. Returns each item's outcome.
 */
export async function learnStoredItems(orgId: string): Promise<LearnOutcome[]> {
  const outcomes: LearnOutcome[] = [];
  for (const event of fakeInngest.sent("discovery/item.stored")) {
    const key = event.id ?? JSON.stringify(event.data);
    if (learned.has(key) || event.data.orgId !== orgId) continue;
    learned.add(key);
    outcomes.push(await learnFromItem(systemCtx(orgId), itemToLearnSchema.parse(event.data)));
  }
  return outcomes;
}

export async function withCredits(orgId: string): Promise<void> {
  await grantCredits(systemCtx(orgId), 1000);
}

const LABELS = ["business", "newsletter", "marketing", "notification", "personal"];

/** The classify call's answer: Jev picks `label` (business, newsletter, …). */
export function classifiedAs(label: string): void {
  const probabilities = Object.fromEntries(
    LABELS.map((other) => [other, other === label ? 0.92 : 0.02]),
  );
  fakeAiGateway.decision({ choice: label, probabilities });
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
 * by default): `vectors` in order, or ones unrelated to every other.
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
    fakeAiGateway.embeddings(vectors ?? Array.from({ length: kept }, () => unrelated()));
  }
}

// Axes no test picks for `meaning`, handed out in turn.
const UNRELATED_AXES = { from: 1000, to: 1536 };
let nextAxis = UNRELATED_AXES.from;

/**
 * A vector meaning nothing like any other: the default embedding of a scripted fact, so facts a
 * test doesn't relate are never alike (and never make objects match candidates).
 */
export function unrelated(): number[] {
  const axis = nextAxis;
  nextAxis = axis + 1 === UNRELATED_AXES.to ? UNRELATED_AXES.from : axis + 1;
  return meaning(axis);
}

/**
 * A 1536-dimension vector pointing mostly along `axis`, leaning `lean` of the way towards
 * `towards`: two facts on one axis mean nearly the same, two on different axes nothing alike.
 */
export function meaning(axis: number, towards = axis, lean = 0): number[] {
  return Array.from({ length: 1536 }, (_, i) => (i === axis ? 1 - lean : i === towards ? lean : 0));
}
