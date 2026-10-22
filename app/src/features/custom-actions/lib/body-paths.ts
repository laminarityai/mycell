// A custom action's body paths (ADR-0018): each maps a dotted path of property names and list
// indexes to one input, so a nested JSON body is described one scalar value at a time. Checking
// them makes sure they build one body; filling them builds it. Pure: no IO, no ctx.

const KEY = /^[A-Za-z0-9_@$-]+$/;
const INDEX = /^(0|[1-9][0-9]*)$/;
/** Names that would reach an object's prototype rather than a property of the body. */
const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Why `paths` don't make one body, each in words the builder can fix: the body is an object, so
 * it can't start with a list index; no path may be a prefix of another; one place holds either
 * properties or list items, never both; and a list's indexes count up from 0 with none missing.
 */
export function bodyPathIssues(field: string, paths: readonly string[]): string[] {
  const issues: string[] = [];
  const children = new Map<string, Set<string>>();
  for (const path of paths) {
    const keys = path.split(".");
    if (!keys.every((key) => KEY.test(key))) {
      issues.push(
        `${field}.${path}: write a body field like message.body.content, property names and list indexes joined by dots.`,
      );
      continue;
    }
    if (INDEX.test(keys[0] ?? "")) {
      issues.push(`${field}.${path}: the body is an object, so it can't start with a list index.`);
    }
    const unsafe = keys.find((key) => UNSAFE.has(key));
    if (unsafe !== undefined) issues.push(`${field}.${path}: "${unsafe}" can't be a field name.`);
    keys.forEach((key, i) => {
      const parent = keys.slice(0, i).join(".");
      children.set(parent, (children.get(parent) ?? new Set()).add(key));
    });
  }
  for (const path of paths) {
    const inside = paths.find((other) => other.startsWith(`${path}.`));
    if (inside !== undefined) {
      issues.push(`${field}.${path} holds one input, so ${field}.${inside} can't be inside it.`);
    }
  }
  for (const [parent, keys] of children) {
    const at = parent === "" ? field : `${field}.${parent}`;
    const indexes = [...keys].filter((key) => INDEX.test(key));
    if (indexes.length > 0 && indexes.length < keys.size) {
      issues.push(`${at} holds either properties or list items, not both.`);
    } else if (indexes.length > 0 && !indexes.every((index) => Number(index) < indexes.length)) {
      issues.push(`${at} is a list: number its items from 0, with none missing.`);
    }
  }
  return issues;
}

/**
 * The JSON body `fields` (checked body paths, each with its value) make: objects for property
 * names, lists for indexes. A list item an optional input left out closes up its gap.
 */
export function bodyOf(fields: readonly (readonly [string, unknown])[]): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [path, value] of fields) {
    const keys = path.split(".");
    let node: Record<string, unknown> = body;
    keys.forEach((key, i) => {
      if (i === keys.length - 1) {
        node[key] = value;
        return;
      }
      node[key] ??= INDEX.test(keys[i + 1]) ? [] : {};
      node = node[key] as Record<string, unknown>;
    });
  }
  return closed(body) as Record<string, unknown>;
}

// The value with every list's gaps closed up.
function closed(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((item) => item !== undefined).map(closed);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, closed(item)]));
}
