// The runtime feature's prompts (runtime/prompts/), each template with the variables it takes.
import { definePrompts } from "@/lib/prompts";
import draftFile from "../prompts/draft.prompt.yml";
import memoryLookupFile from "../prompts/memory-lookup.prompt.yml";
import stepsFile from "../prompts/steps.prompt.yml";

export const stepPrompts = definePrompts(stepsFile, {
  classifyQuestion: ["question"],
  extractSystem: [],
  extractPrompt: ["message"],
});

export const draftPrompts = definePrompts(draftFile, {
  system: ["instructions"],
  triggerMessage: ["message"],
  triggerThread: ["thread"],
  sheetRange: ["range", "values"],
  stepOutput: ["step", "output"],
});

export const memoryLookupPrompts = definePrompts(memoryLookupFile, {
  nothing: ["step"],
  facts: ["step", "facts"],
  fact: ["about", "statement"],
  disputedFact: ["about", "statement"],
});
