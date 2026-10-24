// A tool step's input values: literals, references, and lists and records of them (types.ts).
// Pure, so client code may import it.
import type { InputValue, Reference } from "./types";

/** Whether an input value is a reference to the trigger or a step above. */
export function isReference(value: InputValue | undefined): value is Reference {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.from === "string"
  );
}

/** Every reference inside `value`, each with its path below `value`, in order. */
export function referencesIn(
  value: InputValue,
  path: (string | number)[] = [],
): { reference: Reference; path: (string | number)[] }[] {
  if (isReference(value)) return [{ reference: value, path }];
  if (Array.isArray(value)) return value.flatMap((item, i) => referencesIn(item, [...path, i]));
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => referencesIn(item, [...path, key]));
}

/** Whether `path` below `value` runs into a reference, whose value only a run knows. */
export function throughReference(value: InputValue, path: readonly PropertyKey[]): boolean {
  let current: InputValue | undefined = value;
  for (const key of path) {
    if (isReference(current)) return true;
    if (current === null || typeof current !== "object") return false;
    current = Array.isArray(current)
      ? current[Number(key)]
      : (current as Record<string, InputValue>)[String(key)];
  }
  return isReference(current);
}
