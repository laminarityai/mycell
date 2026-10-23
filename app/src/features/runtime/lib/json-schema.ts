// The `schema` check's matcher for the JSON Schema subset `features/spec` allows. Each problem
// names where in the output it is and what kind of value is there, never the value (invariant 8).
import type { JsonSchemaSubset, JsonSchemaType } from "@/features/spec/types";
import type { Json } from "@/lib/inngest";

/** What's wrong with `value` against `schema`, in order; empty when it matches. */
export function schemaProblems(schema: JsonSchemaSubset, value: Json, path = ""): string[] {
  const where = path === "" ? "the output" : path;
  const allowed = schema.type === undefined ? undefined : [schema.type].flat();
  if (allowed !== undefined && !allowed.some((type) => isOfType(value, type))) {
    return [`${where} is ${typeName(typeOf(value))}, not ${allowed.map(typeName).join(" or ")}`];
  }
  const problems: string[] = [];
  if (schema.enum !== undefined && !schema.enum.includes(value as never)) {
    problems.push(`${where} is not one of the allowed values`);
  }
  if (typeof value === "number") problems.push(...numberProblems(schema, value, where));
  if (typeof value === "string") problems.push(...lengthProblems(schema, value.length, where));
  if (Array.isArray(value)) {
    problems.push(...itemCountProblems(schema, value.length, where));
    const items = schema.items;
    if (items !== undefined) {
      value.forEach((item, index) => {
        problems.push(...schemaProblems(items, item, `${path}[${String(index)}]`));
      });
    }
  } else if (typeof value === "object" && value !== null) {
    problems.push(...objectProblems(schema, value, path));
  }
  return problems;
}

function numberProblems(schema: JsonSchemaSubset, value: number, where: string): string[] {
  const problems: string[] = [];
  if (schema.minimum !== undefined && value < schema.minimum) {
    problems.push(`${where} is below the minimum ${String(schema.minimum)}`);
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    problems.push(`${where} is above the maximum ${String(schema.maximum)}`);
  }
  return problems;
}

function lengthProblems(schema: JsonSchemaSubset, length: number, where: string): string[] {
  const problems: string[] = [];
  if (schema.minLength !== undefined && length < schema.minLength) {
    problems.push(`${where} is shorter than ${String(schema.minLength)} characters`);
  }
  if (schema.maxLength !== undefined && length > schema.maxLength) {
    problems.push(`${where} is longer than ${String(schema.maxLength)} characters`);
  }
  return problems;
}

function itemCountProblems(schema: JsonSchemaSubset, count: number, where: string): string[] {
  const problems: string[] = [];
  if (schema.minItems !== undefined && count < schema.minItems) {
    problems.push(`${where} has fewer than ${String(schema.minItems)} items`);
  }
  if (schema.maxItems !== undefined && count > schema.maxItems) {
    problems.push(`${where} has more than ${String(schema.maxItems)} items`);
  }
  return problems;
}

function objectProblems(
  schema: JsonSchemaSubset,
  value: { [key: string]: Json },
  path: string,
): string[] {
  const problems: string[] = [];
  const properties = schema.properties ?? {};
  for (const name of schema.required ?? []) {
    if (!(name in value)) problems.push(`${join(path, name)} is missing`);
  }
  for (const [name, property] of Object.entries(properties)) {
    const field = value[name] as Json | undefined;
    if (field !== undefined) problems.push(...schemaProblems(property, field, join(path, name)));
  }
  if (schema.additionalProperties === false) {
    // The output's own keys may be the model's words, so they are counted, not named.
    const unexpected = Object.keys(value).filter((name) => !(name in properties)).length;
    if (unexpected > 0) {
      const where = path === "" ? "the output" : path;
      problems.push(`${where} has ${String(unexpected)} unexpected field(s)`);
    }
  }
  return problems;
}

function join(path: string, name: string): string {
  return path === "" ? name : `${path}.${name}`;
}

function isOfType(value: Json, type: JsonSchemaType): boolean {
  if (type === "integer") return Number.isInteger(value);
  return typeOf(value) === type || (type === "number" && typeof value === "number");
}

function typeOf(value: Json): Exclude<JsonSchemaType, "integer"> {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  return "boolean";
}

function typeName(type: JsonSchemaType): string {
  if (type === "null") return "null";
  return /^[aeiou]/.test(type) ? `an ${type}` : `a ${type}`;
}
