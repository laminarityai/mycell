// The raw database client. Only src/db may import it; features use forOrg(ctx).
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/env";

let pool: Pool | undefined;
let db: NodePgDatabase | undefined;

export function getDb(): NodePgDatabase {
  pool ??= new Pool({ connectionString: env.DATABASE_URL });
  db ??= drizzle({ client: pool });
  return db;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}
