// remember: "remember this" (M9). Memory's `tellFact` saves what the person told Mycel as a fact
// only they see, after the do-not-learn list and the injection screen, filed and embedded as the
// agent's. The tool says what it saved and about whom, or plainly why it saved nothing. The
// conversation keeps only the IDs of what was saved (or why not), never what the fact says.
import { z } from "zod";
import { tellFact } from "@/features/memory/server";
import {
  MAX_TOLD_CHARS,
  TELL_REFUSAL_MESSAGES,
  type TellFactInput,
  type TellRefusal,
} from "@/features/memory/types";
import { ValidationError } from "@/lib/errors";
import type { PromptText } from "@/lib/prompts";
import { toolPrompts } from "./prompts";
import type { AgentToolDefinition } from "./tools";

const rememberInput = z.object({
  statement: z.string().trim().min(1).max(MAX_TOLD_CHARS).describe(toolPrompts.rememberStatement()),
  objectId: z.string().trim().min(1).optional(),
  email: z.string().trim().toLowerCase().min(3).max(320).optional(),
  domain: z.string().trim().toLowerCase().min(3).max(253).optional(),
  name: z.string().trim().min(1).max(200).optional().describe(toolPrompts.rememberName()),
});

type Remembered =
  | {
      saved: true;
      factId: string;
      objectId: string;
      // What the model tells the person: what was saved, about whom, and who sees it.
      confirmation: string;
      instruction: PromptText;
    }
  | { saved: false; reason: TellRefusal; message: string; instruction: PromptText };

/** What the conversation keeps of the result: the IDs of what was saved, or why nothing was. */
export type StoredRemember =
  { saved: true; factIds: string[]; objectIds: string[] } | { saved: false; reason: TellRefusal };

export const rememberTool: AgentToolDefinition<z.infer<typeof rememberInput>, Remembered> = {
  description: toolPrompts.remember(),
  inputSchema: rememberInput,
  async execute(ctx, input) {
    const about: TellFactInput["about"] | undefined =
      input.objectId !== undefined
        ? { objectId: input.objectId }
        : input.email !== undefined
          ? { email: input.email, name: input.name }
          : input.domain !== undefined
            ? { domain: input.domain, name: input.name }
            : undefined;
    if (about === undefined) throw new ValidationError(toolPrompts.nameWhatToRemember());
    // NotFoundError, which the model is told, for an object the person can see nothing about.
    const told = await tellFact(ctx, { about, statement: input.statement });
    if (!told.saved) {
      return {
        saved: false,
        reason: told.reason,
        message: TELL_REFUSAL_MESSAGES[told.reason],
        instruction: toolPrompts.notRemembered(),
      };
    }
    const { fact } = told;
    return {
      saved: true,
      factId: fact.id,
      objectId: fact.about.id,
      confirmation: confirmationOf(fact.about.name, fact.statement),
      instruction: toolPrompts.remembered(),
    };
  },
  stored: (output): StoredRemember =>
    output.saved
      ? { saved: true, factIds: [output.factId], objectIds: [output.objectId] }
      : { saved: false, reason: output.reason },
};

/** "Saved about Acme: … Only you can see this." */
export function confirmationOf(about: string, statement: string): string {
  const sentence = /[.!?]$/.test(statement) ? statement : `${statement}.`;
  return `Saved about ${about}: ${sentence} Only you can see this.`;
}
