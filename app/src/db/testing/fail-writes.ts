// Failing a write on purpose, to see what a transaction does when its last write fails: a
// trigger makes Postgres refuse every insert, update or delete on one table, as a broken
// constraint or a lost connection would.
import { sql } from "drizzle-orm";
import { onTestFinished } from "vitest";
import { getDb } from "../client";

/**
 * Makes every `write` to the table named `table` fail until the returned `restore` is called,
 * or the test ends. Postgres raises "a test failed this write" for the row.
 */
export async function failWrites(
  table: string,
  write: "insert" | "update" | "delete",
): Promise<{ restore: () => Promise<void> }> {
  const name = sql.identifier(`fail_${write}_${table}`);
  const db = getDb();
  await db.execute(sql`
    create function ${name}() returns trigger language plpgsql as $$
    begin
      raise exception 'a test failed this write';
    end
    $$
  `);
  await db.execute(sql`
    create trigger ${name} before ${sql.raw(write)} on ${sql.identifier(table)}
    for each row execute function ${name}()
  `);
  const restore = async () => {
    await db.execute(sql`drop trigger if exists ${name} on ${sql.identifier(table)}`);
    await db.execute(sql`drop function if exists ${name}()`);
  };
  onTestFinished(restore);
  return { restore };
}
