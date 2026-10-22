// Query budgets: how much database work a read does, so a test can pin it. A list read must make
// the same number of queries for 1 row or 100 (docs/conventions.md, "Data access").
import { Client } from "pg";

/** What the database was asked while a callback ran: its queries, and the rows they returned. */
export type QueryCount = { queries: number; rows: number };

/**
 * Counts the queries `fn` sends to Postgres, and the rows they return, until it settles. Every
 * query goes through a pg Client's `query`, the pool's and a transaction's alike (its `begin`
 * and `commit` count too), so this counts there. Anything else querying meanwhile counts too:
 * test files run one at a time, so keep `fn` to the read being pinned.
 */
export async function countQueries(fn: () => Promise<unknown>): Promise<QueryCount> {
  const counted: QueryCount = { queries: 0, rows: 0 };
  const read = (result: unknown) => {
    counted.rows += rowsOf(result);
  };
  const original: unknown = Reflect.get(Client.prototype, "query");
  if (typeof original !== "function") throw new Error("pg's Client has no query method.");
  const counting = function (this: Client, ...args: unknown[]): unknown {
    counted.queries += 1;
    // The pool queries with a callback last; a transaction's client returns a promise.
    const callback = args.at(-1);
    if (typeof callback === "function") {
      args[args.length - 1] = (error: unknown, result: unknown) => {
        read(result);
        Reflect.apply(callback, undefined, [error, result]);
      };
    }
    const returned: unknown = Reflect.apply(original, this, args);
    // The caller handles a failure; this only reads a success.
    if (returned instanceof Promise) void returned.then(read, () => undefined);
    return returned;
  };
  Reflect.set(Client.prototype, "query", counting);
  try {
    await fn();
  } finally {
    Reflect.set(Client.prototype, "query", original);
  }
  return counted;
}

// A query's rows, or a multi-statement query's results' rows; none for a failed one.
function rowsOf(result: unknown): number {
  if (Array.isArray(result)) return result.reduce((sum: number, one) => sum + rowsOf(one), 0);
  if (typeof result !== "object" || result === null || !("rows" in result)) return 0;
  return Array.isArray(result.rows) ? result.rows.length : 0;
}
