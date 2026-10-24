export { cn } from "cn";

/** A plain object: not null, and not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Each item once, in the order first seen: a string by its value, an object by its `id`. */
export function unique<T extends string | { id: string }>(items: readonly T[]): T[] {
  const ids = new Set<string>();
  return items.filter((item) => {
    const id = typeof item === "string" ? item : item.id;
    if (ids.has(id)) return false;
    ids.add(id);
    return true;
  });
}
