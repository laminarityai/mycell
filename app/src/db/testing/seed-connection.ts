// A connection row (Google's, unless a test names another registered app), written straight to
// the database, for the e2e tests: the e2e fake Nango has no Connect UI to connect through, and
// save-time validation reads connections from the database only. A test that needs the
// account's mail seeds it at the fake Nango and passes that connection's ID. Vitest connects through the real flow instead
// (src/testing/connect-helpers.ts).
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../client";

export async function seedGoogleConnection(input: {
  orgId: string;
  ownerUserId: string;
  accountEmail: string;
  kind?: "member" | "org";
  /** The registered app it connects: Google unless a test says otherwise. */
  source?: "google" | "microsoft";
  /** Granted OAuth scopes: full URLs for Google. */
  scopes: string[];
  /** The connection at the e2e fake Nango, for a test whose server reads its source. */
  nangoConnectionId?: string;
  /** Where each ingested app stands on it; none by default. */
  ingest?: Partial<Record<"gmail" | "drive", "backfilling" | "active" | "failed">>;
}): Promise<{ id: string }> {
  const id = randomUUID();
  const nangoConnectionId = input.nangoConnectionId ?? `e2e-${id}`;
  await getDb().execute(sql`
    insert into connections
      (id, org_id, kind, owner_user_id, source, account_email, nango_connection_id, granted_scopes)
    values
      (${id}, ${input.orgId}, ${input.kind ?? "member"}, ${input.ownerUserId}, ${input.source ?? "google"},
       ${input.accountEmail.toLowerCase()}, ${nangoConnectionId},
       array[${sql.join(
         input.scopes.map((scope) => sql`${scope}`),
         sql`, `,
       )}]::text[])
  `);
  for (const [app, status] of Object.entries(input.ingest ?? {})) {
    await getDb().execute(sql`
      insert into ingest_states (id, org_id, connection_id, app, status)
      values (${randomUUID()}, ${input.orgId}, ${id}, ${app}, ${status})
    `);
  }
  return { id };
}
