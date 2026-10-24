// The models feature's prompts (models/prompts/), each template with the variables it takes.
import { definePrompts } from "@/lib/prompts";
import chatTurnFile from "../prompts/chat-turn.prompt.yml";
import classifyFile from "../prompts/classify.prompt.yml";

export const classifyPrompts = definePrompts(classifyFile, {
  system: [],
  prompt: ["question", "labels", "input"],
  confidence: [],
});

export const chatTurnPrompts = definePrompts(chatTurnFile, {
  toolFailed: [],
  toolResultDropped: ["toolName"],
});
