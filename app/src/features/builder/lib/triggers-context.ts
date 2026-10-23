// What can start a run, for the builder's instructions: each trigger as a spec writes it, what a
// run on it is about, and what its steps may read from it. Static: it reads only the triggers'
// declarations (`spec/triggers.ts`), so it never drifts from what validation accepts.
import { defaultTrigger, triggers, triggerTypes } from "@/features/spec/triggers";
import type { PromptText } from "@/lib/prompts";
import { contextPrompts } from "./prompts";

/** Lines for the triggers context section: one entry per trigger type. */
export function triggerLines(): PromptText[] {
  return [
    contextPrompts.triggersIntro(),
    ...triggerTypes.flatMap((type) => {
      const trigger = triggers[type];
      const { item } = trigger;
      return [
        contextPrompts.trigger({
          trigger: JSON.stringify(defaultTrigger(type)),
          words: trigger.words,
          item,
          app: trigger.app,
        }),
        contextPrompts.triggerReads({
          item,
          fields: trigger.fields.map((field) => `"trigger.${field}"`).join(" or "),
        }),
        trigger.repliable
          ? contextPrompts.triggerReplies({
              item,
              context: trigger.context.map((entry) => `"${entry}"`).join(" or "),
            })
          : contextPrompts.triggerNoReply(),
      ];
    }),
    contextPrompts.triggersDefault(),
  ];
}
