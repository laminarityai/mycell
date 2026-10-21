// Invariant 8 checked across the whole database: which tables hold a piece of text anywhere in
// any column of any row. Tests seed a marker into content (a message, a draft, an edit) and
// expect no table to hold it.
import { sql } from "drizzle-orm";
import { getDb } from "../client";

/** The public tables with a row whose text form contains `text`. */
export async function tablesHolding(text: string): Promise<string[]> {
  const db = getDb();
  const { rows } = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' order by tablename`,
  );
  const holding: string[] = [];
  for (const { tablename } of rows) {
    const found = await db.execute(
      sql`select 1 from ${sql.identifier(tablename)} as t where strpos(t::text, ${text}) > 0 limit 1`,
    );
    if (found.rows.length > 0) holding.push(tablename);
  }
  return holding;
}
