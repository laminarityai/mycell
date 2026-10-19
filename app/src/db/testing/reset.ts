import { sql } from "drizzle-orm";
import { getDb } from "../client";

// Empties every table in the public schema. Migration history lives in the drizzle schema
// and is kept.
export async function resetDatabase(): Promise<void> {
  const db = getDb();
  const { rows } = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  if (rows.length === 0) return;
  const tables = rows.map(({ tablename }) => `"public"."${tablename}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${tables} restart identity cascade`));
}
