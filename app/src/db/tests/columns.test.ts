import { eq, sql } from "drizzle-orm";
import { integer, pgTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import { beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import { InvariantError } from "@/lib/errors";
import { getDb } from "../client";
import { zodJsonb } from "../columns";
import { countQueries } from "../testing/count-queries";

const noteSchema = z.object({
  title: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

// A table that exists only in tests: it has no migration.
const jsonRows = pgTable("test_json_rows", {
  id: integer("id").primaryKey(),
  note: zodJsonb("note", noteSchema),
  value: zodJsonb("value", z.json()),
});
type JsonValue = NonNullable<(typeof jsonRows.$inferInsert)["value"]>;

beforeAll(async () => {
  await getDb().execute(sql`
    create table if not exists test_json_rows (id integer primary key, note jsonb, value jsonb)
  `);
});

async function readRow(id: number) {
  const rows = await getDb().select().from(jsonRows).where(eq(jsonRows.id, id));
  return rows.at(0);
}

describe("zodJsonb", () => {
  it("is a jsonb column in SQL", () => {
    expect(jsonRows.note.getSQLType()).toBe("jsonb");
  });

  it("reads back a written value, typed as the schema's output", async () => {
    await getDb()
      .insert(jsonRows)
      .values({ id: 1, note: { title: "Invoices", tags: ["finance"] } });

    const row = await readRow(1);

    expect(row?.note).toEqual({ title: "Invoices", tags: ["finance"] });
    expectTypeOf(row?.note).toEqualTypeOf<{ title: string; tags: string[] } | null | undefined>();
  });

  it("parses what it reads, so the schema's defaults fill a stored value", async () => {
    await getDb().execute(
      sql`insert into test_json_rows (id, note) values (2, ${'{"title": "Receipts"}'}::jsonb)`,
    );

    expect((await readRow(2))?.note).toEqual({ title: "Receipts", tags: [] });
  });

  it("fails as it's read when a stored value no longer fits, naming the column", async () => {
    await getDb().execute(
      sql`insert into test_json_rows (id, note) values (3, ${'{"title": 3}'}::jsonb)`,
    );

    const read = readRow(3);

    await expect(read).rejects.toBeInstanceOf(InvariantError);
    await expect(read).rejects.toThrow(/note/);
  });

  it("refuses a value that doesn't fit before sending the query", async () => {
    const write = async () => {
      await getDb()
        .insert(jsonRows)
        .values({ id: 4, note: { title: "", tags: [] } });
    };

    const counted = await countQueries(() =>
      expect(write()).rejects.toBeInstanceOf(InvariantError),
    );

    expect(counted.queries).toBe(0);
    expect(await readRow(4)).toBeUndefined();
  });

  it("checks the JSON it writes, as a read will get it back", async () => {
    // A value typed as JSON can still hold undefined, through a cast upstream. It isn't JSON,
    // but JSON.stringify drops it, so what's written fits.
    const value = { kept: 1, dropped: undefined } as unknown as JsonValue;

    await getDb().insert(jsonRows).values({ id: 5, value });

    expect((await readRow(5))?.value).toEqual({ kept: 1 });
  });

  it("hands back a stored JSON string as it was, without parsing it again", async () => {
    await getDb().insert(jsonRows).values({ id: 6, value: '{"a": 1}' });

    expect((await readRow(6))?.value).toBe('{"a": 1}');
  });

  it("stores and reads null without the schema", async () => {
    await getDb().insert(jsonRows).values({ id: 7, note: null, value: null });

    expect(await readRow(7)).toEqual({ id: 7, note: null, value: null });
  });
});
