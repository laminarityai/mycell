// Ask Mycel's tools: `models`' chat tools over the agent's turn, each run with the person's own
// ctx, so the agent reaches only what they could. Each says what the conversation keeps of its
// result: only IDs of what it read. Proposing a run and remembering join here as one more entry
// each (#182, #183); the turn doesn't change.
import {
  chatTool,
  type ChatTool,
  type ChatToolDefinition,
  type ChatTools,
} from "@/features/models/server";
import { findMessagesTool } from "./mail-tools";
import { readObjectTool, searchMemoryTool } from "./memory-tools";
import { proposeRunTool } from "./pending-runs";
import { rememberTool } from "./remember-tool";
import { listReviewsTool, listWorkflowsTool } from "./work-tools";

/** What a tool knows about the turn calling it. */
export type AgentTurn = { conversationId: string };

/** An agent tool: its description from agent/prompts/tools.prompt.yml, run as the person. */
export type AgentToolDefinition<I, O> = ChatToolDefinition<I, O, AgentTurn>;

function agentTool<I, O>(definition: AgentToolDefinition<I, O>): ChatTool<AgentTurn> {
  return chatTool(definition);
}

/** Every tool the agent may call, by the name the model calls it. */
export const agentTools: ChatTools<AgentTurn> = {
  search_memory: agentTool(searchMemoryTool),
  read_object: agentTool(readObjectTool),
  remember: agentTool(rememberTool),
  find_messages: agentTool(findMessagesTool),
  list_reviews: agentTool(listReviewsTool),
  list_workflows: agentTool(listWorkflowsTool),
  propose_run: agentTool(proposeRunTool),
};
