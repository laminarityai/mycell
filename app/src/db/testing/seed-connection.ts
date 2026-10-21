// A Google connection row, written straight to the database, for the e2e tests: the e2e server
// has no fake Nango to connect through, and save-time validation reads connections from the
// database only. Vitest connects through the real flow instead (src/testing/connect-helpers.ts).
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../client";

export async function seedGoogleConnection(input: {
  orgId: string;
  ownerUserId: string;
  accountEmail: string;
  kind?: "member" | "org";
  /** Granted OAuth scopes, as full URLs. */
  scopes: string[];
}): Promise<{ id: string }> {
  const id = randomUUID();
  await getDb().execute(sql`
    insert into connections
      (id, org_id, kind, owner_user_id, source, account_email, nango_connection_id, granted_scopes)
    values
      (${id}, ${input.orgId}, ${input.kind ?? "member"}, ${input.ownerUserId}, 'google',
       ${input.accountEmail.toLowerCase()}, ${`e2e-${id}`},
       array[${sql.join(
         input.scopes.map((scope) => sql`${scope}`),
         sql`, `,
       )}]::text[])
  `);
  return { id };
}
