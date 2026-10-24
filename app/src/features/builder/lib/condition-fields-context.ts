// The fields a branch's condition may test that come from declarations rather than steps
// (ADR-0015): the trigger's facts and the result fields catalog actions declare, each with its
// type. Static: it reads only the spec's declarations and those of the company's action set.
import type { ActionSet } from "@/features/policy/types";
import { triggers, triggerTypes } from "@/features/spec/triggers";
import type { PromptText } from "@/lib/prompts";
import { contextPrompts } from "./prompts";

/** Lines for the condition-fields context section: trigger facts and declared action results. */
export function declaredFieldLines(actions: ActionSet): PromptText[] {
  const facts = triggerTypes.flatMap((trigger) => [
    contextPrompts.triggerFacts({ trigger, item: triggers[trigger].item }),
    ...triggers[trigger].facts.map((fact) =>
      contextPrompts.triggerFact({ name: fact.name, type: fact.type, label: fact.label }),
    ),
  ]);
  const results = actions.actions.flatMap((action) =>
    (action.conditionFields ?? []).map((field) =>
      contextPrompts.resultField({
        action: action.name,
        name: field.name,
        type: field.type,
        label: field.label,
      }),
    ),
  );
  return [...facts, contextPrompts.resultFields(), ...results, contextPrompts.nothingElse()];
}
