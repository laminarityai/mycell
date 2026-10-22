// The fields a branch's condition may test that come from declarations rather than steps
// (ADR-0015): the trigger's facts and the result fields catalog actions declare, each with its
// type. Static: it reads only the spec's and the catalog's declarations.
import { catalog } from "@/features/policy/catalog";
import { triggers, triggerTypes } from "@/features/spec/triggers";

const type = (name: string, kind: string, label: string) => `${name} (${kind}): ${label}`;

/** Lines for the condition-fields context section: trigger facts and declared action results. */
export function declaredFieldLines(): string[] {
  const facts = triggerTypes.flatMap((trigger) => [
    `- The ${trigger} trigger's facts about the ${triggers[trigger].item}, as { "subject": { "from": "trigger.<fact>" }, ... }:`,
    ...triggers[trigger].facts.map(
      (fact) => `  - ${type(`trigger.${fact.name}`, fact.type, fact.label)}`,
    ),
  ]);
  const actions = Object.values(catalog).flatMap((action) =>
    (action.conditionFields ?? []).map(
      (field) => `  - ${action.name}: ${type(`<step>.${field.name}`, field.type, field.label)}`,
    ),
  );
  return [
    ...facts,
    '- A tool step\'s result fields, as { "subject": { "from": "<tool step id>.<field>" }, ... }, ' +
      "for the actions that declare them:",
    ...actions,
    "Nothing else can be tested.",
  ];
}
