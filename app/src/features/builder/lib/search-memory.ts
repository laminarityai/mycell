// search_memory, and the memory context section: the builder reads company-wide memory only
// (ADR-0023), the view an org-credential run has, each read logged as the builder's with the
// admin as the person reading. Any admin may open a conversation, and it keeps the agent's
// replies and proposals whole, so a fact from one admin's private mail must never reach the
// agent: it could repeat it to another admin. The tool's results reach the model only, and the
// conversation keeps the IDs of what was found, never what a fact says.
import { z } from "zod";
import { searchCompanyWideMemory } from "@/features/memory/server";
import type { MemorySearchResult } from "@/features/memory/types";
import type { Ctx } from "@/lib/ctx";
import { joinPrompts } from "@/lib/prompts";
import type { ContextSection } from "./context";
import { contextPrompts, toolPrompts } from "./prompts";
import type { ToolDefinition, TurnInfo } from "./tools";

const BUILDER = { kind: "builder" } as const;

/** The most facts the context section holds; the tool may ask for more. */
const CONTEXT_FACTS = 10;
/** The longest text memory searches. */
const MAX_QUERY = 500;

const inputSchema = z.object({
  query: z.string().trim().min(1).max(MAX_QUERY).describe(toolPrompts.searchMemoryQuery()),
  limit: z.number().int().min(1).max(20).optional(),
});

type Found = {
  objects: { id: string; kind: string; name: string; keys: string[] }[];
  facts: { id: string; about: string; statement: string; recordedAt: string }[];
};

export const searchMemoryTool: ToolDefinition<z.infer<typeof inputSchema>, Found> = {
  description: toolPrompts.searchMemory(),
  inputSchema,
  async execute(ctx, { query, limit }) {
    return found(await searchCompanyWideMemory(ctx, { text: query, limit }, BUILDER));
  },
  stored: ({ objects, facts }) => ({
    objectIds: objects.map((object) => object.id),
    factIds: facts.map((fact) => fact.id),
  }),
};

/** The facts the admin's message finds, for the agent's instructions this turn only. */
export async function memorySection(ctx: Ctx, turn: TurnInfo): Promise<ContextSection> {
  const text = turn.message.slice(0, MAX_QUERY).trim();
  const { facts } =
    text === ""
      ? { facts: [] }
      : found(await searchCompanyWideMemory(ctx, { text, limit: CONTEXT_FACTS }, BUILDER));
  const lines =
    facts.length === 0
      ? [contextPrompts.noMemoryFound()]
      : [
          contextPrompts.memoryFound(),
          ...facts.map(({ about, statement }) => contextPrompts.memoryFact({ about, statement })),
        ];
  return {
    title: contextPrompts.memoryTitle(),
    content: joinPrompts([contextPrompts.memory(), ...lines], "\n"),
  };
}

function found(result: MemorySearchResult): Found {
  return {
    objects: result.objects.map((object) => ({
      id: object.id,
      kind: object.kind,
      name: object.name,
      keys: object.keys.map((key) => key.value),
    })),
    facts: result.facts.map((fact) => ({
      id: fact.id,
      about: fact.subject.name,
      statement: fact.statement,
      recordedAt: fact.recordedAt.toISOString(),
    })),
  };
}
