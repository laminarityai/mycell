// file_capability_request: when one call can't do what the admin described, the agent asks our
// team for it (ADR-0018), with the call sequence or code it would need. The SDK checks the
// input against the schema first, so a malformed request comes back to the model as an error
// and stores nothing.
import { registeredApps } from "@/features/connections/registered-apps";
import { fileCapabilityRequest } from "@/features/custom-actions/server";
import {
  capabilityRequestInputSchema,
  type CapabilityRequestInput,
  type FiledCapabilityRequest,
} from "@/features/custom-actions/types";
import { joinPrompts } from "@/lib/prompts";
import { toolPrompts } from "./prompts";
import type { ToolDefinition } from "./tools";

const apps = joinPrompts(
  registeredApps.map((app) => toolPrompts.app({ id: app.id, name: app.name })),
  ", ",
);

export const fileCapabilityRequestTool: ToolDefinition<
  CapabilityRequestInput,
  FiledCapabilityRequest
> = {
  description: toolPrompts.fileCapabilityRequest({ apps }),
  inputSchema: capabilityRequestInputSchema,
  execute: (ctx, input, turn) =>
    fileCapabilityRequest(ctx, input, { conversationId: turn.conversationId }),
};
