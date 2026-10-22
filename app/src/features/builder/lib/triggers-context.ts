// What can start a run, for the builder's instructions: each trigger as a spec writes it, what a
// run on it is about, and what its steps may read from it. Static: it reads only the triggers'
// declarations (`spec/triggers.ts`), so it never drifts from what validation accepts.
import { defaultTrigger, triggers, triggerTypes } from "@/features/spec/triggers";

/** Lines for the triggers context section: one entry per trigger type. */
export function triggerLines(): string[] {
  return [
    "A spec has exactly one trigger. Each run starts on one item the trigger found:",
    ...triggerTypes.flatMap((type) => {
      const trigger = triggers[type];
      const reads = trigger.fields.map((field) => `"trigger.${field}"`).join(" or ");
      const context = trigger.context.map((entry) => `"${entry}"`).join(" or ");
      return [
        `- ${JSON.stringify(defaultTrigger(type))}: ${trigger.words}. Each run is about one ` +
          `${trigger.item}; its connection must be granted ${trigger.app}.`,
        `  Classify and extract steps read the ${trigger.item}. A tool input may read ${reads}.`,
        trigger.repliable
          ? `  A draft replies to the ${trigger.item} and may read ${context}; an escalate hands it to a person.`
          : `  There is no Gmail message to reply to: use no draft step and no escalate step.`,
      ];
    }),
    'Gmail\'s labelIds default to ["INBOX"]. Change the trigger only when the admin asks.',
  ];
}
