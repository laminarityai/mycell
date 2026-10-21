// What a branch's condition may test, for the agent writing specs (ADR-0015): the trigger's
// facts, an extract step's fields, and the result fields catalog actions declare, each with the
// operators its type allows. Static: it reads only the spec's and the catalog's declarations.
import { catalog } from "@/features/policy/catalog";
import { triggerFacts } from "@/features/spec/triggers";
import { checkOperators } from "@/features/spec/types";

const type = (name: string, kind: string, label: string) => `${name} (${kind}): ${label}`;

/** The context section listing every field a condition may test, by what declares it. */
export function conditionFieldsSection(): { title: string; content: string } {
  const facts = Object.entries(triggerFacts).flatMap(([trigger, declared]) => [
    `- The ${trigger} trigger's facts about the message:`,
    ...declared.map((fact) => `  - ${type(`trigger.${fact.name}`, fact.type, fact.label)}`),
  ]);
  const actions = Object.values(catalog).flatMap((action) =>
    (action.conditionFields ?? []).map(
      (field) => `  - ${action.name}: ${type(`<step>.${field.name}`, field.type, field.label)}`,
    ),
  );
  const operators = Object.entries(checkOperators).map(
    ([kind, ops]) => `  - ${kind === "any" ? "any type" : kind}: ${ops.join(", ")}`,
  );
  const content = [
    "A value check's subject is one of these, above its branch on its own path, and its " +
      "operator one its type allows. Nothing else can be tested.",
    ...facts,
    "- An extract step's fields, as <step>.<field>: string is text, number is number, boolean is yesNo.",
    "- A tool step's result fields, as <step>.<field>, for the actions that declare them:",
    ...actions,
    "Operators by type:",
    ...operators,
  ];
  return { title: "Fields a condition may test", content: content.join("\n") };
}
