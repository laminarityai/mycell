// search_memory and read_object: memory exactly as the person can see it (ADR-0023), read as
// the agent with the person reading (ADR-0024). Everything found is screened for prompt
// injection before the model reads it, and with no screen configured memory isn't read at all.
// The model gets each fact's words and markers; the conversation keeps only the IDs of what was
// found (invariant 8), which the page cites again in the person's view (`citations.ts`).
import { z } from "zod";
import { readObject, searchMemory } from "@/features/memory/server";
import type { MemoryFact, MemoryObject } from "@/features/memory/types";
import { injectionScreenConfigured } from "@/features/models/server";
import { ValidationError } from "@/lib/errors";
import { toolPrompts } from "./prompts";
import { noteFor, screenItems } from "./screen";
import type { AgentToolDefinition } from "./tools";

const AGENT = { kind: "agent" } as const;

/** The most facts one search hands the model by default, and at most. */
const DEFAULT_FACTS = 10;
const MAX_FACTS = 20;

/** A fact as the model reads it: its ID to cite, its words, and its markers when they hold. */
type ModelFact = {
  id: string;
  about: string;
  statement: string;
  linkedTo?: string;
  validFrom?: string;
  validUntil?: string;
  recorded: string;
  disputed?: true;
  outsideOnly?: true;
  // The person told Mycel this themselves ("remember this").
  toldByYou?: true;
  replaced?: true;
};

type ModelObject = { objectId: string; kind: string; name: string; keys: string[] };

/** Memory couldn't be read for the model. Stored as it is. */
type Unavailable = { available: false; message: string };

type Found = {
  available: true;
  objects: ModelObject[];
  facts: ModelFact[];
  screenedOut: number;
  note?: string;
};

type Read = {
  available: true;
  object: ModelObject | null;
  facts: ModelFact[];
  history: ModelFact[];
  screenedOut: number;
  note?: string;
};

/** What the conversation keeps of either tool's result: IDs only. */
export type StoredRead =
  | { available: false }
  | { available: true; objectIds: string[]; factIds: string[]; screenedOut: number };

const unavailable = (): Unavailable => ({
  available: false,
  message: toolPrompts.memoryUnavailable(),
});

const searchInput = z.object({
  query: z.string().trim().min(1).max(500).describe(toolPrompts.searchMemoryQuery()),
  limit: z.number().int().min(1).max(MAX_FACTS).optional(),
});

export const searchMemoryTool: AgentToolDefinition<
  z.infer<typeof searchInput>,
  Found | Unavailable
> = {
  description: toolPrompts.searchMemory(),
  inputSchema: searchInput,
  async execute(ctx, { query, limit }) {
    // Nothing is read that couldn't be screened.
    if (!injectionScreenConfigured()) return unavailable();
    const found = await searchMemory(ctx, { text: query, limit: limit ?? DEFAULT_FACTS }, AGENT);
    const items: Item[] = [
      ...found.objects.map((object): Item => ({ object: modelObject(object) })),
      ...found.facts.map((fact): Item => ({
        fact: modelFact(fact, fact.subject.name),
        of: fact,
        subjectId: fact.subject.id,
      })),
    ];
    const screened = await screenItems(ctx, items, itemText);
    if (!screened.ok) return unavailable();
    const objects = screened.kept.flatMap((item) => ("object" in item ? [item.object] : []));
    // A fact about, or linking to, an object that was dropped goes with it.
    const dropped = new Set(
      found.objects.map((o) => o.id).filter((id) => !objects.some((o) => o.objectId === id)),
    );
    const facts = screened.kept.flatMap((item) =>
      "fact" in item && !dropped.has(item.subjectId) && !linksTo(item.of, dropped)
        ? [item.fact]
        : [],
    );
    const screenedOut = items.length - objects.length - facts.length;
    return { available: true, objects, facts, screenedOut, ...noteFor(screenedOut) };
  },
  stored: (output) =>
    output.available
      ? stored(
          output.objects.map((object) => object.objectId),
          output.facts.map((fact) => fact.id),
          output.screenedOut,
        )
      : { available: false },
};

const readInput = z.object({
  objectId: z.string().trim().min(1).optional(),
  email: z.string().trim().toLowerCase().min(3).max(320).optional(),
  domain: z.string().trim().toLowerCase().min(3).max(253).optional(),
});

export const readObjectTool: AgentToolDefinition<z.infer<typeof readInput>, Read | Unavailable> = {
  description: toolPrompts.readObject(),
  inputSchema: readInput,
  async execute(ctx, input) {
    const lookup =
      input.objectId !== undefined
        ? { id: input.objectId }
        : input.email !== undefined
          ? { key: { kind: "email" as const, value: input.email } }
          : input.domain !== undefined
            ? { key: { kind: "domain" as const, value: input.domain } }
            : undefined;
    if (lookup === undefined) throw new ValidationError(toolPrompts.nameAnObject());
    if (!injectionScreenConfigured()) return unavailable();
    // NotFoundError, which the model is told, for an object the person can see nothing about.
    const read = await readObject(ctx, lookup, AGENT);
    const object = modelObject(read);
    const items: Item[] = [
      { object },
      ...read.facts.map((fact): Item => ({
        fact: modelFact(fact, read.name),
        of: fact,
        subjectId: read.id,
      })),
      ...read.history.map((fact): Item => ({
        fact: { ...modelFact(fact, read.name), replaced: true },
        of: fact,
        subjectId: read.id,
      })),
    ];
    const screened = await screenItems(ctx, items, itemText);
    if (!screened.ok) return unavailable();
    // The object itself was flagged: nothing about it is handed on.
    if (!screened.kept.some((item) => "object" in item)) {
      const all = items.length;
      return {
        available: true,
        object: null,
        facts: [],
        history: [],
        screenedOut: all,
        ...noteFor(all),
      };
    }
    const facts = screened.kept.flatMap((item) => ("fact" in item ? [item.fact] : []));
    const screenedOut = screened.dropped;
    return {
      available: true,
      object,
      facts: facts.filter((fact) => fact.replaced !== true),
      history: facts.filter((fact) => fact.replaced === true),
      screenedOut,
      ...noteFor(screenedOut),
    };
  },
  stored: (output) =>
    output.available
      ? stored(
          output.object === null ? [] : [output.object.objectId],
          [...output.facts, ...output.history].map((fact) => fact.id),
          output.screenedOut,
        )
      : { available: false },
};

/** One thing a tool would hand the model, screened on its own when a result is flagged. */
type Item = { object: ModelObject } | { fact: ModelFact; of: MemoryFact; subjectId: string };

function itemText(item: Item): string {
  if ("object" in item) return [item.object.name, ...item.object.keys].join("\n");
  const { about, statement, linkedTo } = item.fact;
  return [about, statement, linkedTo ?? ""].join("\n").trim();
}

function modelObject(object: Pick<MemoryObject, "id" | "kind" | "name" | "keys">): ModelObject {
  return {
    objectId: object.id,
    kind: object.kind,
    name: object.name,
    keys: object.keys.map((key) => key.value),
  };
}

// The ID first, so the model reads it with the fact, then its words, then its markers.
function modelFact(fact: MemoryFact, about: string): ModelFact {
  return {
    id: fact.id,
    about,
    statement: fact.statement,
    ...(fact.linkedObject === null ? {} : { linkedTo: fact.linkedObject.name }),
    ...(fact.validFrom === null ? {} : { validFrom: day(fact.validFrom) }),
    ...(fact.validUntil === null ? {} : { validUntil: day(fact.validUntil) }),
    recorded: day(fact.recordedAt),
    ...(fact.conflictsWith === null ? {} : { disputed: true as const }),
    ...(fact.outsideOnly ? { outsideOnly: true as const } : {}),
    ...(fact.told ? { toldByYou: true as const } : {}),
  };
}

function linksTo(fact: MemoryFact, ids: Set<string>): boolean {
  return fact.linkedObject !== null && ids.has(fact.linkedObject.id);
}

function stored(objectIds: string[], factIds: string[], screenedOut: number): StoredRead {
  return { available: true, objectIds, factIds, screenedOut };
}

const day = (date: Date) => date.toISOString().slice(0, 10);
