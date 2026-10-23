// A summary of one object (ADR-0023): built when asked, by one `fast` call over only the facts
// its caller can see, and handed back, never stored. The object is read through the logged read,
// so the summary's read is in the access log like any other, and a caller who can see no fact
// about it gets NotFoundError before any model is called. The call is metered (invariant 7).
import { callModel } from "@/features/models/server";
import type { CallAttribution } from "@/features/models/types";
import type { Ctx } from "@/lib/ctx";
import { joinPrompts, type PromptText } from "@/lib/prompts";
import {
  memoryReaderSchema,
  type MemoryFact,
  type MemoryReader,
  type ObjectLookup,
  type ObjectSummary,
} from "../types";
import { readObject } from "./logged-reads";
import { summarizePrompts } from "./prompts";

export async function summarizeObject(
  ctx: Ctx,
  lookup: ObjectLookup,
  reader: MemoryReader = { kind: "person" },
): Promise<ObjectSummary> {
  const parsed = memoryReaderSchema.parse(reader);
  const object = await readObject(ctx, lookup, parsed);
  const { output } = await callModel(ctx, "fast", {
    system: summarizePrompts.system(),
    prompt: summarizePrompts.prompt({
      kind: object.kind,
      name: object.name,
      facts: joinPrompts(object.facts.map(line), "\n"),
    }),
    ...attributionOf(parsed),
  });
  const { id, kind, name, keys } = object;
  return {
    object: { id, kind, name, keys },
    summary: output.trim(),
    factCount: object.facts.length,
  };
}

function line(fact: MemoryFact): PromptText {
  return summarizePrompts.fact({
    statement: fact.statement,
    recorded: fact.recordedAt.toISOString().slice(0, 10),
  });
}

/**
 * A summary is charged to whatever asked for it: a workflow's run, like the run's other model
 * calls; the builder chat; or, for a person's own, `memory_summary`, which the Credits page
 * counts as memory's but memory's budget, which caps learning, doesn't add up.
 */
function attributionOf(reader: MemoryReader): CallAttribution {
  switch (reader.kind) {
    case "workflow_run":
      return { runId: reader.runId, workflowId: reader.workflowId };
    case "builder":
      return { purpose: "builder" };
    case "person":
      return { purpose: "memory_summary" };
  }
}
