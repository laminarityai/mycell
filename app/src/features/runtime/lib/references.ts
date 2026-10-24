// Resolving `{ from: "<step>.<field>" }` and `{ from: "trigger.<field>" }` in a tool's input,
// inside the step that uses them. Trigger fields that need the message are fetched there.
import type { Reference } from "@/features/spec/types";
import type { Json } from "@/lib/inngest";
import { RunStepError } from "./failures";
import { messageRef } from "./gmail";
import type { StepContext } from "./step-context";

type Literal = string | number | boolean | null;
type InputValue = Literal | Reference | (Literal | Reference)[];

/**
 * The trigger's fields a reference may read: the message's ID and its thread's, or the invite's
 * event ID. A run's source_ref is the item that started it.
 */
const TRIGGER_FIELDS: Partial<Record<string, (context: StepContext) => Promise<Json>>> = {
  messageId: (context) => Promise.resolve(context.run.sourceRef),
  eventId: (context) => Promise.resolve(context.run.sourceRef),
  threadId: async (context) =>
    (await messageRef(context.ctx, context.run.connectionId, context.run.sourceRef)).threadId,
};

export async function resolveInput(
  context: StepContext,
  input: Record<string, InputValue>,
): Promise<Record<string, Json>> {
  const resolved: Record<string, Json> = {};
  for (const [name, value] of Object.entries(input)) {
    resolved[name] = Array.isArray(value)
      ? await Promise.all(value.map((item) => resolveValue(context, item)))
      : await resolveValue(context, value);
  }
  return resolved;
}

async function resolveValue(context: StepContext, value: InputValue): Promise<Json> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value as Json;
  const [source = "", ...path] = value.from.split(".");
  if (source === "trigger") {
    const field = TRIGGER_FIELDS[path.join(".")];
    if (field === undefined) throw badReference(value.from);
    return field(context);
  }
  let current: Json | undefined = context.outputs[source];
  for (const key of path) {
    current =
      current !== null && typeof current === "object" && !Array.isArray(current)
        ? current[key]
        : undefined;
  }
  if (current === undefined) throw badReference(value.from);
  return current;
}

function badReference(from: string) {
  return new RunStepError("bad_reference", `The reference ${from} has no value.`);
}
