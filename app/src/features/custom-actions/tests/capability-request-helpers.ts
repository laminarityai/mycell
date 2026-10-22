import { startConversation } from "@/features/builder/server";
import type { Ctx } from "@/lib/ctx";
import { fileCapabilityRequest } from "../server";
import type { CapabilityRequestInput, FiledCapabilityRequest } from "../types";

export const MERGE_CONTACTS: CapabilityRequestInput = {
  app: "microsoft",
  operation: "Merge two contacts",
  inputs: [{ name: "keep", description: "The contact to keep" }],
  outputs: [],
  reason: "Merging takes three calls.",
  codeDraft: "await patch(keep, merged);",
};

/** Files `request` from a new builder conversation of the admin's, as the builder tool does. */
export async function fileRequest(
  admin: Ctx,
  request: CapabilityRequestInput = MERGE_CONTACTS,
): Promise<FiledCapabilityRequest & { conversationId: string }> {
  const { id } = await startConversation(admin, {});
  const filed = await fileCapabilityRequest(admin, request, { conversationId: id });
  return { ...filed, conversationId: id };
}
