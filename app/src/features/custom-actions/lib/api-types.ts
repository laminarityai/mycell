// Collecting the types an operation index names: each schema an operation's body or response
// reaches, flattened to its fields one level deep, with each field's type in words. A named
// schema keeps its vendor's name; an inline object is named after where it sits.
import { z } from "zod";
import {
  looseSchema,
  shortText,
  typeWords,
  type ApiField,
  type ApiType,
  type LooseSchema,
} from "./api-index-types";

/** A `$ref`'s schema and the name the index gives it, or undefined when it resolves to none. */
export type RefResolver = (ref: string) => { name: string; schema: LooseSchema } | undefined;

export class TypeCollector {
  private readonly pending: { name: string; schema: LooseSchema }[] = [];

  constructor(
    readonly types: Record<string, ApiType>,
    private readonly resolve: RefResolver,
  ) {}

  /** The type a schema at `context` names, collecting it and every type its fields reach. */
  typeOf(schema: LooseSchema, context: string): string {
    const words = typeWords(
      schema,
      (ref) => this.refName(ref),
      (inline) => this.inline(inline, context),
    );
    this.drain();
    return words;
  }

  private refName(ref: string): string {
    const resolved = this.resolve(ref);
    if (resolved === undefined) return "object";
    if (!Object.hasOwn(this.types, resolved.name)) {
      // Claimed before its fields are read, so a type that reaches itself ends.
      this.types[resolved.name] = { fields: [] };
      this.pending.push(resolved);
    }
    return resolved.name;
  }

  private inline(schema: LooseSchema, name: string): string {
    if (!Object.hasOwn(this.types, name)) {
      this.types[name] = { fields: [] };
      this.pending.push({ name, schema });
    }
    return name;
  }

  private drain(): void {
    for (let next = this.pending.shift(); next !== undefined; next = this.pending.shift()) {
      this.types[next.name] = {
        ...(descriptionOf(next.schema) === undefined
          ? {}
          : { description: descriptionOf(next.schema) }),
        fields: this.fieldsOf(next.schema, next.name, new Set()),
      };
    }
  }

  // A schema's fields: its own properties, and those of every schema it extends (`allOf`).
  private fieldsOf(schema: LooseSchema, context: string, seen: Set<string>): ApiField[] {
    const fields = new Map<string, ApiField>();
    if (typeof schema.$ref === "string" && !seen.has(schema.$ref)) {
      const resolved = this.resolve(schema.$ref);
      seen.add(schema.$ref);
      if (resolved !== undefined) {
        for (const field of this.fieldsOf(resolved.schema, context, seen)) {
          fields.set(field.name, field);
        }
      }
    }
    for (const part of z.array(looseSchema).catch([]).parse(schema.allOf)) {
      for (const field of this.fieldsOf(part, context, seen)) fields.set(field.name, field);
    }
    const properties = z.record(z.string(), looseSchema).catch({}).parse(schema.properties);
    for (const [name, property] of Object.entries(properties)) {
      const type = typeWords(
        property,
        (ref) => this.refName(ref),
        (inline) => this.inline(inline, `${context}.${name}`),
      );
      const description = shortText(property.description);
      fields.set(name, { name, type, ...(description === undefined ? {} : { description }) });
    }
    return [...fields.values()];
  }
}

function descriptionOf(schema: LooseSchema): string | undefined {
  return shortText(schema.description);
}
