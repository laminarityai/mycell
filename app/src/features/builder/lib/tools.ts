// The agent's tools. Each runs with the admin's ctx, so the agent reaches only what the admin
// could (spec #43, story 39), and says what the conversation keeps of its result: the whole
// result by default, or less (`read_examples` keeps only source refs, invariant 8, and
// `search_memory` only the IDs of what it found, ADR-0023). A new tool
// is one more entry in `builderTools`; the turn loop doesn't change.
import { tool, type Tool } from "ai";
import { z } from "zod";
import { getWorkflow } from "@/features/workflows/server";
import type { Ctx } from "@/lib/ctx";
import type { CustomActionRecord } from "@/features/custom-actions/types";
import { lookUpAppApiTool } from "./api-lookup-tool";
import { fileCapabilityRequestTool } from "./capability-request-tool";
import { describeCustomActionTool } from "./custom-action-tool";
import { proposeSpec } from "./proposals";
import { readExamples } from "./read-examples";
import { searchMemoryTool } from "./search-memory";

/** What a tool knows about the turn calling it, and the state the turn's tools keep. */
export type TurnInfo = {
  conversationId: string;
  workflowId: string | null;
  /** The admin's message that started the turn. */
  message: string;
  /** The `propose_spec` calls in this turn that failed validation so far. */
  failedProposals: number;
  /**
   * The custom actions `describe_custom_action` checked in this turn, which its proposals may
   * use and carry, to be stored only when one is accepted (ADR-0018).
   */
  customActions: CustomActionRecord[];
};

export type ToolDefinition<I, O> = {
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

const proposeSpecTool = builderTool({
  description:
    "Propose a whole workflow spec for the admin to accept or reject: for a new workflow, or a " +
    "change to an existing one (the conversation's workflow unless you pass another's " +
    "workflowId). Send the complete spec (specVersion 2), not a patch. It is validated as saving would; when " +
    "it fails you get every issue to fix and call again. Nothing is saved until an admin " +
    "accepts it, and nothing is ever published by you.",
  inputSchema: z.object({
    workflowId: z.string().min(1).optional(),
    spec: z.record(z.string(), z.unknown()),
    summary: z.string().min(1).describe("One or two plain sentences on what it does or changes."),
  }),
  execute: (ctx, input, turn) => proposeSpec(ctx, input, turn),
});

/** Every tool the agent may call, by the name the model calls it. */
export const builderTools: Record<string, BuilderTool> = {
  describe_custom_action: builderTool(describeCustomActionTool),
  file_capability_request: builderTool(fileCapabilityRequestTool),
  get_workflow: getWorkflowTool,
  look_up_app_api: builderTool(lookUpAppApiTool),
  propose_spec: proposeSpecTool,
  read_examples: builderTool(readExamples),
  search_memory: builderTool(searchMemoryTool),
};
