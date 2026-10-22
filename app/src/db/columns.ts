// Column types Drizzle doesn't have. A JSON column's shape can change while rows written in the
// old shape stay stored (specs went from specVersion 1 to 2), so every JSON column is declared
// with `zodJsonb`: a stored value that no longer fits fails as it's read, not deep inside
// whatever reads it next (docs/conventions.md, "Data access").
import { customType } from "drizzle-orm/pg-core";
import { z } from "zod";
import { InvariantError } from "@/lib/errors";

/**
 * A `jsonb` column whose value `schema` checks both ways: before every write, and on every read,
 * which gets the schema's output. A value that doesn't fit is InvariantError, a bug: a write
 * throws before its query is sent. Null skips the schema: Drizzle reads and writes it as null.
 */
export function zodJsonb<Schema extends z.ZodType>(name: string, schema: Schema) {
  return customType<{ data: z.output<Schema>; driverData: unknown }>({
    dataType: () => "jsonb",
    toDriver(value) {
      const json = JSON.stringify(value);
      // What a read will get back, which may differ from `value`: JSON.stringify drops a field
      // set to undefined and writes a Date as a string.
      fit(name, schema, JSON.parse(json), "written");
      return json;
    },
    // node-postgres hands jsonb over already parsed. Parsing a string again would turn a stored
    // JSON string into whatever it spells.
    fromDriver: (value) => fit(name, schema, value, "stored"),
  })(name);
}

function fit<Schema extends z.ZodType>(
  name: string,
  schema: Schema,
  value: unknown,
  when: "written" | "stored",
): z.output<Schema> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new InvariantError(
    `The JSON ${when} in column "${name}" doesn't fit its schema:\n${z.prettifyError(parsed.error)}`,
  );
}
