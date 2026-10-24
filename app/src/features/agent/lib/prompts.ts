// The agent feature's prompts (agent/prompts/), each template with the variables it takes.
import { definePrompts } from "@/lib/prompts";
import instructionsFile from "../prompts/instructions.prompt.yml";
import toolsFile from "../prompts/tools.prompt.yml";

export const instructionPrompts = definePrompts(instructionsFile, {
  instructions: ["today"],
});

export const toolPrompts = definePrompts(toolsFile, {
  searchMemory: [],
  searchMemoryQuery: [],
  readObject: [],
  memoryUnavailable: [],
  screenedOut: ["count"],
  nameAnObject: [],
});
