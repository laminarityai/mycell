// The org-scoped handle (ADR-0003): the only way feature code reaches tenant tables.
// Every read, count, update, and delete is filtered to ctx.orgId, and every insert takes its
// org_id from ctx. A caller can't name another org: org_id isn't accepted as input.
import "server-only";
import {
  and,
  count,
  eq,
  getTableColumns,
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

/**
 * A change to apply to rows: each column's new value, or SQL computing it from the row (one
 * update setting each row its own value, by a `case` on its ID).
 */
export type TenantChanges<T extends TenantTable> = {
  [K in keyof TenantValues<T>]?: TenantValues<T>[K] | SQL;
};

/** A column's name on `table`, as its rows hold it. */
export type ColumnName<T extends TenantTable> = keyof InferSelectModel<T> & string;

/** One of `table`'s columns. */
type ColumnOf<T extends TenantTable> = T["_"]["columns"][keyof T["_"]["columns"]];

/** One of `table`'s columns holding a number, which `sum` adds up. */
export type NumberColumn<T extends TenantTable> = Extract<ColumnOf<T>, { _: { data: number } }>;

/**
 * The columns `countBy` and `sumBy` group by, each under the name its value comes back as. A
 * group may also be SQL computed from the row (its UTC day), typed by what it returns.
 * `count` and `total` are taken: they're the group's count and sum.
 */
export type GroupColumns<T extends TenantTable> = Record<string, ColumnOf<T> | SQL> & {
  count?: never;
  total?: never;
};

/** One group's value of each group column. */
type GroupValues<G> = {
  [K in keyof G]: G[K] extends Column ? GetColumnData<G[K]> : G[K] extends SQL<infer V> ? V : never;
};

/** One group `countBy` found: its value of each group column, and how many rows it has. */
export type GroupCount<G> = GroupValues<G> & { count: number };

/** One group `sumBy` found: its value of each group column, and the total of its rows. */
export type GroupSum<G> = GroupValues<G> & { total: number };

export type SelectOptions<K extends string = string> = {
  /**
   * Only these columns, by their names on the table: the rows hold just them. Read what a
   * caller uses, not a whole row it only counts or maps (a fact's embedding, a spec).
   */
  columns?: readonly K[];
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
  select<T extends TenantTable, K extends ColumnName<T> = ColumnName<T>>(
    table: T,
    options?: SelectOptions<K>,
  ): Promise<Pick<InferSelectModel<T>, K>[]>;
  /** How many of the org's rows match `where`, counted in the database. */
  count(table: TenantTable, where?: SQL): Promise<number>;
  /** The total of `column` over the org's rows matching `where`; 0 when none do. */
  sum<T extends TenantTable>(table: T, column: NumberColumn<T>, where?: SQL): Promise<number>;
  /**
   * The total of `column` over the org's rows matching `where`, per distinct value of
   * `groupBy`'s columns: one row per group, with its values under `groupBy`'s names and its
   * `total` (spending by purpose, or by workflow, in one query). Groups no row has aren't
   * returned. Name at least one column; `sum` adds up with none.
   */
  sumBy<T extends TenantTable, G extends GroupColumns<T>>(
    table: T,
    column: NumberColumn<T>,
    groupBy: G,
    where?: SQL,
  ): Promise<GroupSum<G>[]>;
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
    set: TenantChanges<T>,
    where?: SQL,
  ): Promise<InferSelectModel<T>[]>;
  delete<T extends TenantTable>(table: T, where?: SQL): Promise<InferSelectModel<T>[]>;
  /** Deletes like `delete`, returning only how many rows went, never the rows themselves. */
  deleteCount(table: TenantTable, where?: SQL): Promise<number>;
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
      const fields = options.columns === undefined ? undefined : named(table, options.columns);
      const query = (
        options.distinctOn === undefined
          ? fields === undefined
            ? db.select()
            : db.select(fields)
          : fields === undefined
            ? db.selectDistinctOn(options.distinctOn)
            : db.selectDistinctOn(options.distinctOn, fields)
      )
        .from(source)
        .where(inOrg(table, options.where))
        .orderBy(...(options.orderBy ?? []))
        .$dynamic();
      const rows = options.limit === undefined ? await query : await query.limit(options.limit);
      // The rows hold the named columns, or every column when none are named.
      return rows as never;
    },

    async count(table, where) {
      const source: PgTable = table;
      const rows = await db.select({ count: count() }).from(source).where(inOrg(table, where));
      return rows.at(0)?.count ?? 0;
    },

    async sum(table, column, where) {
      const source: PgTable = table;
      const rows = await db
        .select({ total: total(column) })
        .from(source)
        .where(inOrg(table, where));
      return rows.at(0)?.total ?? 0;
    },

    async sumBy(table, column, groupBy, where) {
      const source: PgTable = table;
      const columns: Record<string, PgColumn | SQL> = groupBy;
      const rows = await db
        .select({ ...columns, total: total(column) })
        .from(source)
        .where(inOrg(table, where))
        .groupBy(...Object.values(columns));
      return rows as GroupSum<typeof groupBy>[];
    },

    async countBy(table, groupBy, where) {
      const source: PgTable = table;
      const columns: Record<string, PgColumn | SQL> = groupBy;
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

    async deleteCount(table, where) {
      const source: PgTable = table;
      const result = await db.delete(source).where(inOrg(table, where));
      return result.rowCount ?? 0;
    },

    transaction(fn) {
      return db.transaction((tx) => fn(scoped(ctx, tx)));
    },
  };
}

// A column's sum, as a number. A sum over no rows (or only nulls) is null, and Postgres returns
// numeric and bigint sums as strings.
function total(column: Column): SQL<number> {
  return sql<number>`coalesce(sum(${column}), 0)`.mapWith(Number);
}

// The table's columns with these names, as a select's fields.
function named(table: TenantTable, names: readonly string[]): Record<string, PgColumn> {
  const columns: Record<string, PgColumn> = getTableColumns(table);
  return Object.fromEntries(names.map((name) => [name, columns[name]]));
}

// Types already forbid orgId; this also drops one smuggled in at runtime (e.g. a parsed form).
function withoutOrgId(values: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([key]) => key !== "orgId"));
}
