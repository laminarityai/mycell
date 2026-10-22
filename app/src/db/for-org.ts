// The org-scoped handle (ADR-0003): the only way feature code reaches tenant tables.
// Every read, count, update, and delete is filtered to ctx.orgId, and every insert takes its
// org_id from ctx. A caller can't name another org: org_id isn't accepted as input.
import {
  and,
  count,
  eq,
  sql,
  type Column,
  type GetColumnData,
  type InferInsertModel,
  type InferSelectModel,
  type SQL,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AnyPgColumn, PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Ctx } from "@/lib/ctx";
import { getDb } from "./client";

/** A tenant-owned table: one with a non-null `org_id` column, exposed as `orgId`. */
export type TenantTable = PgTable & { orgId: AnyPgColumn<{ notNull: true }> };

/** A row to insert or a change to apply, without `orgId`: that always comes from ctx. */
export type TenantValues<T extends TenantTable> = Omit<InferInsertModel<T>, "orgId">;

/** One of `table`'s columns. */
type ColumnOf<T extends TenantTable> = T["_"]["columns"][keyof T["_"]["columns"]];

/** One of `table`'s columns holding a number, which `sum` adds up. */
export type NumberColumn<T extends TenantTable> = Extract<ColumnOf<T>, { _: { data: number } }>;

/**
 * The columns `countBy` groups by, each under the name its value comes back as. `count` is
 * taken: it's the group's count.
 */
export type GroupColumns<T extends TenantTable> = Record<string, ColumnOf<T>> & { count?: never };

/** One group `countBy` found: its value of each group column, and how many rows it has. */
export type GroupCount<G> = {
  [K in keyof G]: G[K] extends Column ? GetColumnData<G[K]> : never;
} & { count: number };

export type SelectOptions = {
  where?: SQL;
  orderBy?: (PgColumn | SQL)[];
  limit?: number;
  /**
   * Postgres's DISTINCT ON: only the first row of each distinct value of these columns, first
   * in `orderBy`'s order. Postgres requires `orderBy` to start with the same columns, so the
   * rest of `orderBy` picks which row each value keeps (the newest version of each workflow).
   */
  distinctOn?: [PgColumn, ...PgColumn[]];
};

export type InsertOptions = {
  /** Skip rows that would break a unique constraint instead of failing (idempotent writes). */
  onConflictDoNothing?: boolean;
};

export type OrgScopedDb = {
  select<T extends TenantTable>(table: T, options?: SelectOptions): Promise<InferSelectModel<T>[]>;
  /** How many of the org's rows match `where`, counted in the database. */
  count(table: TenantTable, where?: SQL): Promise<number>;
  /** The total of `column` over the org's rows matching `where`; 0 when none do. */
  sum<T extends TenantTable>(table: T, column: NumberColumn<T>, where?: SQL): Promise<number>;
  /**
   * The org's rows matching `where`, counted per distinct value of `groupBy`'s columns: one
   * row per group, with its values under `groupBy`'s names and its `count`. Groups no row has
   * aren't returned. Name at least one column; `count` counts with none.
   */
  countBy<T extends TenantTable, G extends GroupColumns<T>>(
    table: T,
    groupBy: G,
    where?: SQL,
  ): Promise<GroupCount<G>[]>;
  insert<T extends TenantTable>(
    table: T,
    values: TenantValues<T> | TenantValues<T>[],
    options?: InsertOptions,
  ): Promise<InferSelectModel<T>[]>;
  update<T extends TenantTable>(
    table: T,
    set: Partial<TenantValues<T>>,
    where?: SQL,
  ): Promise<InferSelectModel<T>[]>;
  delete<T extends TenantTable>(table: T, where?: SQL): Promise<InferSelectModel<T>[]>;
  /**
   * Runs `fn` in one database transaction, with a handle scoped to the same org: its writes
   * commit together, or none do when `fn` throws (the error is rethrown).
   */
  transaction<R>(fn: (tx: OrgScopedDb) => Promise<R>): Promise<R>;
};

// The database, or a transaction on it: both run the same queries.
type Executor = Pick<
  NodePgDatabase,
  "select" | "selectDistinctOn" | "insert" | "update" | "delete" | "transaction"
>;

export function forOrg(ctx: Ctx): OrgScopedDb {
  return scoped(ctx, getDb());
}

function scoped(ctx: Ctx, db: Executor): OrgScopedDb {
  const inOrg = (table: TenantTable, where?: SQL) => and(eq(table.orgId, ctx.orgId), where);

  return {
    async select(table, options = {}) {
      const source: PgTable = table;
      const query = (
        options.distinctOn === undefined ? db.select() : db.selectDistinctOn(options.distinctOn)
      )
        .from(source)
        .where(inOrg(table, options.where))
        .orderBy(...(options.orderBy ?? []))
        .$dynamic();
      const rows = options.limit === undefined ? await query : await query.limit(options.limit);
      return rows as InferSelectModel<typeof table>[];
    },

    async count(table, where) {
      const source: PgTable = table;
      const rows = await db.select({ count: count() }).from(source).where(inOrg(table, where));
      return rows.at(0)?.count ?? 0;
    },

    async sum(table, column, where) {
      const source: PgTable = table;
      // A sum over no rows is null, and Postgres returns numeric and bigint sums as strings.
      const total = sql<number>`coalesce(sum(${column}), 0)`.mapWith(Number);
      const rows = await db.select({ total }).from(source).where(inOrg(table, where));
      return rows.at(0)?.total ?? 0;
    },

    async countBy(table, groupBy, where) {
      const source: PgTable = table;
      const columns: Record<string, PgColumn> = groupBy;
      const rows = await db
        .select({ ...columns, count: count() })
        .from(source)
        .where(inOrg(table, where))
        .groupBy(...Object.values(columns));
      return rows as GroupCount<typeof groupBy>[];
    },

    async insert(table, values, options = {}) {
      const rows = (Array.isArray(values) ? values : [values]).map((row) => ({
        ...withoutOrgId(row),
        orgId: ctx.orgId,
      }));
      if (rows.length === 0) return [];
      const query = db
        .insert(table)
        .values(rows as never)
        .$dynamic();
      const inserted = await (
        options.onConflictDoNothing === true ? query.onConflictDoNothing() : query
      ).returning();
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

    transaction(fn) {
      return db.transaction((tx) => fn(scoped(ctx, tx)));
    },
  };
}

// Types already forbid orgId; this also drops one smuggled in at runtime (e.g. a parsed form).
function withoutOrgId(values: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([key]) => key !== "orgId"));
}
