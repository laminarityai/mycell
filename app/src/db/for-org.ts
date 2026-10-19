// The org-scoped handle (ADR-0003): the only way feature code reaches tenant tables.
// Every read, update, and delete is filtered to ctx.orgId, and every insert takes its
// org_id from ctx. A caller can't name another org: org_id isn't accepted as input.
import { and, eq, type InferInsertModel, type InferSelectModel, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Ctx } from "@/lib/ctx";
import { getDb } from "./client";

/** A tenant-owned table: one with a non-null `org_id` column, exposed as `orgId`. */
export type TenantTable = PgTable & { orgId: AnyPgColumn<{ notNull: true }> };

/** A row to insert or a change to apply, without `orgId`: that always comes from ctx. */
export type TenantValues<T extends TenantTable> = Omit<InferInsertModel<T>, "orgId">;

export type SelectOptions = {
  where?: SQL;
  orderBy?: (PgColumn | SQL)[];
  limit?: number;
};

export type OrgScopedDb = {
  select<T extends TenantTable>(table: T, options?: SelectOptions): Promise<InferSelectModel<T>[]>;
  insert<T extends TenantTable>(
    table: T,
    values: TenantValues<T> | TenantValues<T>[],
  ): Promise<InferSelectModel<T>[]>;
  update<T extends TenantTable>(
    table: T,
    set: Partial<TenantValues<T>>,
    where?: SQL,
  ): Promise<InferSelectModel<T>[]>;
  delete<T extends TenantTable>(table: T, where?: SQL): Promise<InferSelectModel<T>[]>;
};

export function forOrg(ctx: Ctx): OrgScopedDb {
  const db = getDb();
  const inOrg = (table: TenantTable, where?: SQL) => and(eq(table.orgId, ctx.orgId), where);

  return {
    async select(table, options = {}) {
      const source: PgTable = table;
      const query = db
        .select()
        .from(source)
        .where(inOrg(table, options.where))
        .orderBy(...(options.orderBy ?? []))
        .$dynamic();
      const rows = options.limit === undefined ? await query : await query.limit(options.limit);
      return rows as InferSelectModel<typeof table>[];
    },

    async insert(table, values) {
      const rows = (Array.isArray(values) ? values : [values]).map((row) => ({
        ...withoutOrgId(row),
        orgId: ctx.orgId,
      }));
      if (rows.length === 0) return [];
      const inserted = await db
        .insert(table)
        .values(rows as never)
        .returning();
      return inserted as InferSelectModel<typeof table>[];
    },

    async update(table, set, where) {
      const updated = await db
        .update(table)
        .set(withoutOrgId(set) as never)
        .where(inOrg(table, where))
        .returning();
      return updated as InferSelectModel<typeof table>[];
    },

    async delete(table, where) {
      const deleted = await db.delete(table).where(inOrg(table, where)).returning();
      return deleted as InferSelectModel<typeof table>[];
    },
  };
}

// Types already forbid orgId; this also drops one smuggled in at runtime (e.g. a parsed form).
function withoutOrgId(values: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([key]) => key !== "orgId"));
}
