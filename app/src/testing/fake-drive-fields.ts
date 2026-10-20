// Google's partial-response `fields` parameter, for the fake Drive: `a, b(c, d(e))` keeps `a`,
// and `b`'s `c` and `d.e`, of each object (arrays apply it to every element).
import type { JsonBodyType } from "msw";

/** A parsed `fields` selection: each field kept, with its own sub-selection or null for all. */
export type FieldSelection = Map<string, FieldSelection | null>;

export function parseFields(fields: string): FieldSelection {
  const [selection, rest] = parseList(fields.replace(/\s+/g, ""), 0);
  if (rest !== fields.replace(/\s+/g, "").length) throw new Error(`Bad fields: ${fields}`);
  return selection;
}

// Parses `name(sub), name, …` from `at`, stopping at a `)` or the end. Returns where it stopped.
function parseList(text: string, at: number): [FieldSelection, number] {
  const selection: FieldSelection = new Map();
  let i = at;
  while (i < text.length && text[i] !== ")") {
    const name = /^[A-Za-z0-9_]+/.exec(text.slice(i))?.[0];
    if (name === undefined) throw new Error(`Bad fields at ${String(i)}: ${text}`);
    i += name.length;
    let sub: FieldSelection | null = null;
    if (text[i] === "(") {
      [sub, i] = parseList(text, i + 1);
      if (text[i] !== ")") throw new Error(`Unclosed ( in fields: ${text}`);
      i += 1;
    }
    selection.set(name, sub);
    if (text[i] === ",") i += 1;
  }
  return [selection, i];
}

/** `value` with only the selected fields. */
export function project(value: unknown, selection: FieldSelection): JsonBodyType {
  if (Array.isArray(value)) return value.map((item) => project(item, selection));
  if (typeof value !== "object" || value === null) return value as JsonBodyType;
  const kept: Record<string, JsonBodyType> = {};
  for (const [name, sub] of selection) {
    const field = (value as Record<string, unknown>)[name];
    if (field !== undefined)
      kept[name] = sub === null ? (field as JsonBodyType) : project(field, sub);
  }
  return kept;
}
