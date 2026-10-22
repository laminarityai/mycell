// The fields a branch's condition may test that come from declarations rather than steps
// (ADR-0015): the trigger's facts and the result fields catalog actions declare, each with its
// type. Static: it reads only the spec's declarations and those of the company's action set.
import type { ActionSet } from "@/features/policy/types";
import { triggerFacts } from "@/features/spec/triggers";

const type = (name: string, kind: string, label: string) => `${name} (${kind}): ${label}`;

/** Lines for the condition-fields context section: trigger facts and declared action results. */
export function declaredFieldLines(actions: ActionSet): string[] {
  const facts = Object.entries(triggerFacts).flatMap(([trigger, declared]) => [
    `- The ${trigger} trigger's facts about the message, as { "subject": { "from": "trigger.<fact>" }, ... }:`,
    ...declared.map((fact) => `  - ${type(`trigger.${fact.name}`, fact.type, fact.label)}`),
  ]);
  const results = actions.actions.flatMap((action) =>
    (action.conditionFields ?? []).map(
      (field) => `  - ${action.name}: ${type(`<step>.${field.name}`, field.type, field.label)}`,
    ),
  );
  return [
    ...facts,
    '- A tool step\'s result fields, as { "subject": { "from": "<tool step id>.<field>" }, ... }, ' +
      "for the actions that declare them:",
    ...results,
    "Nothing else can be tested.",
  ];
}
