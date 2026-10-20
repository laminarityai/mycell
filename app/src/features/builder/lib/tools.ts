// The agent's tools. Each runs with the admin's ctx, so the agent reaches only what the admin
// could (spec #43, story 39), and says what the conversation keeps of its result: the whole
// result by default, or less (`read_examples` keeps only source refs, invariant 8). A new tool
// is one more entry in `builderTools`; the turn loop doesn't change.
import { tool, type Tool } from "ai";
import { z } from "zod";
import { getWorkflow } from "@/features/workflows/server";
import type { Ctx } from "@/lib/ctx";

/** What a tool knows about the turn calling it. */
export type TurnInfo = { conversationId: string; workflowId: string | null };

type ToolDefinition<I, O> = {
  description: string;
  inputSchema: z.ZodType<I>;
  execute(ctx: Ctx, input: I, turn: TurnInfo): Promise<O>;
  /** What the conversation stores of the result; the result itself when left out. */
  stored?(output: O): unknown;
};

export type BuilderTool = {
  /** The AI SDK tool, bound to the admin's ctx and the turn. */
  bind(ctx: Ctx, turn: TurnInfo): Tool;
  stored(output: unknown): unknown;
};

export function builderTool<I, O>(definition: ToolDefinition<I, O>): BuilderTool {
  return {
    bind: (ctx, turn) =>
      tool({
        description: definition.description,
        inputSchema: definition.inputSchema as z.ZodType,
        // The SDK parses the model's input with `inputSchema` before it calls this.
        execute: (input: unknown): Promise<unknown> => definition.execute(ctx, input as I, turn),
      }),
    // The SDK hands back what `execute` returned, so the output is this tool's O.
    stored: (output) => (definition.stored ? definition.stored(output as O) : output),
  };
}

const getWorkflowTool = builderTool({
  description:
    "Read one of the org's workflows: its name, whether it is published, and its current " +
    "working spec, including edits an admin made by hand since you last looked.",
  inputSchema: z.object({ workflowId: z.string().min(1) }),
  async execute(ctx, { workflowId }) {
    const workflow = await getWorkflow(ctx, workflowId);
    return {
      workflowId: workflow.id,
      name: workflow.name,
      published: workflow.versions.length > 0,
      workingSpec: workflow.workingSpec,
    };
  },
});

/** Every tool the agent may call, by the name the model calls it. */
export const builderTools: Record<string, BuilderTool> = {
  get_workflow: getWorkflowTool,
};
