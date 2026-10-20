import { sql } from "drizzle-orm";
import { closeDb, getDb } from "../client";

// Sets the test database's default time zone, as a Postgres configured outside UTC would have,
// and drops the pool so every new connection starts in it. Postgres's `now()` and its reading of
// a time without a zone both follow the session's time zone.
export async function setDatabaseTimeZone(timeZone: string): Promise<void> {
  await alterDatabase(`set timezone to '${timeZone.replaceAll("'", "''")}'`);
}

/** Puts the test database back on the server's default time zone. */
export async function resetDatabaseTimeZone(): Promise<void> {
  await alterDatabase("reset timezone");
}

async function alterDatabase(change: string): Promise<void> {
  const { rows } = await getDb().execute<{ name: string }>(sql`select current_database() as name`);
  await getDb().execute(sql.raw(`alter database "${rows[0].name}" ${change}`));
  await closeDb();
}
