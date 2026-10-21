// Writing a spec out for an admin to read and edit. Postgres's jsonb doesn't keep key order, so a
// saved spec comes back with its keys shuffled; this puts them back in reading order. Pure, so
// client code may import it.
import { isRecord } from "@/lib/utils";

const SPEC_ORDER = ["specVersion", "id", "credentials", "trigger", "steps", "autonomy"];
const STEP_ORDER = ["id", "type"];

/**
 * The spec as indented JSON: `specVersion`, `id`, `credentials`, `trigger`, `steps` (each step
 * with `id` and `type` first) and `autonomy`, then any other keys in the order they came.
 */
export function formatSpec(spec: object): string {
  const ordered = inOrder(spec, SPEC_ORDER);
  if (Array.isArray(ordered.steps)) {
    ordered.steps = ordered.steps.map((step: unknown) =>
      isRecord(step) ? inOrder(step, STEP_ORDER) : step,
    );
  }
  return JSON.stringify(ordered, null, 2);
}

function inOrder(value: object, first: string[]): Record<string, unknown> {
  const entries = Object.entries(value);
  const known = first.flatMap((key) => entries.filter(([name]) => name === key));
  const rest = entries.filter(([name]) => !first.includes(name));
  return Object.fromEntries([...known, ...rest]);
}
