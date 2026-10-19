// Vitest global setup: create the test database if it's missing, then apply the committed
// migrations to it, exactly as `pnpm db:migrate` would.
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { env } from "@/env";
import { closeDb, getDb } from "../client";

export async function setup(): Promise<void> {
  await createDatabaseIfMissing(env.DATABASE_URL);
  await migrate(getDb(), { migrationsFolder: "src/db/migrations" });
  await closeDb();
}

async function createDatabaseIfMissing(databaseUrl: string): Promise<void> {
  const url = new URL(databaseUrl);
  const name = url.pathname.slice(1);
  url.pathname = "/postgres";
  const admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query("select 1 from pg_database where datname = $1", [name]);
    if (rowCount === 0) await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }
}
