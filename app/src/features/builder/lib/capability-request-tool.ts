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
import type { ToolDefinition } from "./tools";

const appIds = registeredApps.map((app) => `"${app.id}" (${app.name})`).join(", ");

export const fileCapabilityRequestTool: ToolDefinition<
  CapabilityRequestInput,
  FiledCapabilityRequest
> = {
  description:
    "Ask Mycel's team for something the action catalog can't do and one call can't either, " +
    "so they can build it into the catalog. Use it after telling the admin plainly what you " +
    `can't do. app is a registered app's ID (${appIds}) or the name of any other app. ` +
    "Describe the operation in a few plain words, its inputs and outputs, why one call can't " +
    "do it, and, when you can, a codeDraft: the call sequence or code it would need. Never " +
    "quote the content of a message or file in it. Asking again for the same app and " +
    "operation counts as one more ask on the same request.",
  inputSchema: capabilityRequestInputSchema,
  execute: (ctx, input, turn) =>
    fileCapabilityRequest(ctx, input, { conversationId: turn.conversationId }),
};
