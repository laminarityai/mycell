// The custom-actions feature's prompts (custom-actions/prompts/), each template with the
// variables it takes.
import { definePrompts } from "@/lib/prompts";
import apiLookupFile from "../prompts/api-lookup.prompt.yml";
import capabilityRequestFile from "../prompts/capability-request.prompt.yml";

export const capabilityRequestPrompts = definePrompts(capabilityRequestFile, {
  app: [],
  operation: [],
  inputs: [],
  outputs: [],
  reason: [],
  codeDraft: [],
  filed: [],
  askedAgain: ["count", "status"],
});

export const apiLookupPrompts = definePrompts(apiLookupFile, {
  refused: ["reason"],
  read: [],
  write: [],
  noType: ["app", "type"],
});
