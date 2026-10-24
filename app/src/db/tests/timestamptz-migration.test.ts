// The timestamptz migration: times stored before it, without a zone, were UTC (Drizzle writes a
// Date as UTC, and production's Postgres runs in UTC), so they must read back as the same UTC
// instant afterwards, whatever time zone the migrating session is in. The test migrates a
// scratch database up to just before the migration, stores times the old way, then applies it.
import { readFileSync, cpSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "@/env";

const MIGRATIONS = "src/db/migrations";
const STORED = "2026-01-15 09:30:00";
const INSTANT = "2026-01-15T09:30:00.000Z";

const scratchUrl = new URL(env.DATABASE_URL);
const scratchName = `${scratchUrl.pathname.slice(1)}_timestamptz`;
scratchUrl.pathname = `/${scratchName}`;
const adminUrl = new URL(env.DATABASE_URL);
adminUrl.pathname = "/postgres";

const folders: string[] = [];
let pool: Pool;

interface Journal {
  entries: { idx: number; tag: string }[];
}

/** A migrations folder holding the committed migrations up to and including `last`. */
function migrationsThrough(last: number): string {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const folder = mkdtempSync(join(tmpdir(), "timestamptz-migrations-"));
  folders.push(folder);
  mkdirSync(join(folder, "meta"));
  const entries = journal.entries.slice(0, last + 1);
  writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
  for (const entry of entries)
    cpSync(`${MIGRATIONS}/${entry.tag}.sql`, join(folder, `${entry.tag}.sql`));
  return folder;
}

async function admin(query: string): Promise<void> {
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    await client.query(query);
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  await admin(`drop database if exists "${scratchName}" with (force)`);
  await admin(`create database "${scratchName}"`);
  // Outside UTC, as a local Postgres may be: a naive time converted in the session's zone
  // would shift by hours.
  await admin(`alter database "${scratchName}" set timezone to 'America/Los_Angeles'`);
  pool = new Pool({ connectionString: scratchUrl.toString() });
});

afterAll(async () => {
  await pool.end();
  await admin(`drop database if exists "${scratchName}" with (force)`);
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

describe("the timestamptz migration", () => {
  it("reads the times stored without a zone as the same UTC instant", async () => {
    const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
    const index = journal.entries.findIndex((entry) => entry.tag.endsWith("_timestamptz"));
    expect(index).toBeGreaterThan(0);
    const db = drizzle(pool);

    await migrate(db, { migrationsFolder: migrationsThrough(index - 1) });
    await pool.query(`
      insert into "user" (id, name, email) values ('u1', 'Ada', 'ada@example.com');
      insert into organization (id, name, slug, created_at, workspace_domain)
        values ('o1', 'Acme', 'acme', '${STORED}', 'example.com');
      insert into member (id, organization_id, user_id, role, created_at)
        values ('m1', 'o1', 'u1', 'owner', '${STORED}');
      insert into connections
        (id, org_id, kind, owner_user_id, source, account_email, nango_connection_id, created_at)
        values ('c1', 'o1', 'member', 'u1', 'google', 'ada@example.com', 'n1', '${STORED}');
      insert into connect_attempts (id, org_id, user_id, kind, source, status, created_at)
        values ('a1', 'o1', 'u1', 'member', 'google', 'connected', '${STORED}');
      insert into tags (id, org_id, name, created_at) values ('t1', 'o1', 'sales', '${STORED}');
      insert into tag_assignments (org_id, tag_id, user_id, created_at)
        values ('o1', 't1', 'u1', '${STORED}');
      insert into events (id, org_id, connection_id, owner_scope, owner_user_id, source,
        source_ref, type, occurred_at, counterparties, attachments, label_ids, created_at)
        values ('e1', 'o1', 'c1', 'member', 'u1', 'gmail', 'msg-1', 'email.received',
          '${STORED}', '{}', '[]', '{}', '${STORED}');
    `);

    await migrate(db, { migrationsFolder: migrationsThrough(index) });

    const { rows } = await pool.query<{ time: Date; type: string }>(`
      select occurred_at as time, pg_typeof(occurred_at)::text as type from events
      union all select created_at, pg_typeof(created_at)::text from events
      union all select created_at, pg_typeof(created_at)::text from connections
      union all select created_at, pg_typeof(created_at)::text from connect_attempts
      union all select created_at, pg_typeof(created_at)::text from tags
      union all select created_at, pg_typeof(created_at)::text from tag_assignments
    `);
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.type).toBe("timestamp with time zone");
      expect(row.time.toISOString()).toBe(INSTANT);
    }
  });
});
