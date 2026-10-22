// The models feature's prompts (models/prompts/), each template with the variables it takes.
import { definePrompts } from "@/lib/prompts";
import classifyFile from "../prompts/classify.prompt.yml";

export const classifyPrompts = definePrompts(classifyFile, {
  system: [],
  prompt: ["question", "labels", "input"],
  confidence: [],
});
