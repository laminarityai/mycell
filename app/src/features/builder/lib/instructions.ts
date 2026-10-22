// The agent's instructions: the rules the validator also enforces, then the org's context, both
// in builder/prompts/. What a condition may test is a context section (`context.ts`), as it
// grows with the catalog.
import { joinPrompts, type PromptText } from "@/lib/prompts";
import type { ContextSection } from "./context";
import { rulesPrompts } from "./prompts";

export function instructionsWith(sections: ContextSection[]): PromptText {
  return joinPrompts(
    [rulesPrompts.rules(), ...sections.map((section) => rulesPrompts.section(section))],
    "\n\n",
  );
}
