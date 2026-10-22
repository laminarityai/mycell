// An operation index: the compact form of a registered app's published API description that
// the builder chat searches (ADR-0018). `pnpm api-index` builds one per app from the copied
// description, once, so a search never parses the description itself (Microsoft Graph's is
// 44 MB of YAML). It holds only what the vendor publishes, never customer data.
import { z } from "zod";
import { registeredAppIdSchema } from "@/features/connections/types";
import { httpMethodSchema } from "@/features/policy/types";

const fieldSchema = z.object({
  name: z.string(),
  /** In words: text, number, yes/no, one of …, list of …, or a named type's name. */
  type: z.string(),
  description: z.string().optional(),
});
export type ApiField = z.infer<typeof fieldSchema>;

const parameterSchema = fieldSchema.extend({
  /** A path placeholder or a query parameter: the only places a custom action fills. */
  in: z.enum(["path", "query"]),
  required: z.boolean(),
});
export type ApiParameter = z.infer<typeof parameterSchema>;

const operationSchema = z.object({
  method: httpMethodSchema,
  /** The path a custom action calls, from the app's root, with `{input}` placeholders. */
  path: z.string(),
  /** The vendor's operation ID. */
  id: z.string(),
  summary: z.string(),
  parameters: z.array(parameterSchema),
  /** The request body's and the response's type, by name in `types`. */
  body: z.string().optional(),
  response: z.string().optional(),
});
export type ApiOperation = z.infer<typeof operationSchema>;

const typeSchema = z.object({
  description: z.string().optional(),
  fields: z.array(fieldSchema),
});
export type ApiType = z.infer<typeof typeSchema>;

export const apiIndexSchema = z.object({
  app: registeredAppIdSchema,
  /** The description files it was built from, with their SHA-256, to tell when it's stale. */
  sources: z.array(z.object({ path: z.string(), sha256: z.string() })),
  operations: z.array(operationSchema),
  types: z.record(z.string(), typeSchema),
});
export type ApiIndex = z.infer<typeof apiIndexSchema>;

/** How much of a vendor's description the index keeps: its first sentence, at most this long. */
const DESCRIPTION_LENGTH = 160;

/** A vendor's description, cut to its first sentence and at most DESCRIPTION_LENGTH. */
export function shortText(text: unknown): string | undefined {
  if (typeof text !== "string") return undefined;
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat === "") return undefined;
  const sentence = /^.*?[.!?](?=\s|$)/.exec(flat)?.[0] ?? flat;
  return sentence.length <= DESCRIPTION_LENGTH
    ? sentence
    : `${sentence.slice(0, DESCRIPTION_LENGTH - 1).trimEnd()}…`;
}

/**
 * A vendor's placeholder name as a custom action's input name (letters, digits and _):
 * `message-id` becomes `messageId`, so the builder can use the path as it reads.
 */
export function inputNameOf(name: string): string {
  const camel = name
    .replace(/^\+/, "")
    .replace(/[^A-Za-z0-9]+([A-Za-z0-9])/g, (_, next: string) => next.toUpperCase())
    .replace(/[^A-Za-z0-9_]/g, "");
  return /^[A-Za-z]/.test(camel) ? camel : `p${camel}`;
}

/** A path with each `{placeholder}` renamed to its input name. */
export function placeholdersAsInputs(path: string): string {
  return path.replace(/\{([^{}]*)\}/g, (_, name: string) => `{${inputNameOf(name)}}`);
}

/** A loosely parsed schema object from a description: only the parts the index reads. */
export const looseSchema = z.record(z.string(), z.unknown());
export type LooseSchema = z.infer<typeof looseSchema>;

/** The type a vendor's schema names, in the words a field's `type` uses. */
export function typeWords(
  schema: LooseSchema,
  refName: (ref: string) => string,
  inline: (schema: LooseSchema) => string,
): string {
  if (typeof schema.$ref === "string") return refName(schema.$ref);
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    const options = z.array(looseSchema).safeParse(schema[key]);
    if (!options.success) continue;
    const named = options.data.filter((option) => !isNullOnly(option));
    const only = named.at(0);
    if (named.length === 1 && only !== undefined) return typeWords(only, refName, inline);
    if (named.length > 1) return inline(schema);
  }
  const enumValues = z.array(z.unknown()).safeParse(schema.enum);
  if (enumValues.success && enumValues.data.length > 0) {
    const values = enumValues.data.map(String);
    const shown = values.slice(0, 8).join(", ");
    return `one of ${shown}${values.length > 8 ? ", …" : ""}`;
  }
  switch (schema.type) {
    case "string":
      return typeof schema.format === "string" && schema.format !== "byte"
        ? `text (${schema.format})`
        : "text";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "yes/no";
    case "array": {
      const items = looseSchema.safeParse(schema.items);
      return items.success ? `list of ${typeWords(items.data, refName, inline)}` : "list";
    }
    default:
      return schema.properties !== undefined || schema.allOf !== undefined
        ? inline(schema)
        : "object";
  }
}

function isNullOnly(schema: LooseSchema): boolean {
  return schema.type === "object" && schema.nullable === true && schema.properties === undefined;
}
