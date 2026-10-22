// Keeping a transaction to its own connection (docs/conventions.md, "Transactions"): a read
// inside its callback through `forOrg(ctx)` or another feature's `server.ts` takes a second
// connection from the pool while the transaction holds one, and doesn't see its writes.
import type { Client } from "pg";
import { queryText, watchQueries } from "./watch-queries";

/**
 * The SQL of each query `fn` sends on another connection while a transaction is open, in the
 * order sent. A test pins a transaction by expecting none. A transaction opens with drizzle's
 * `begin` and closes with its `commit` or `rollback`; queries before and after it, or on its
 * own connection, aren't listed.
 */
export async function queriesOnOtherConnections(fn: () => Promise<unknown>): Promise<string[]> {
  const inTransaction = new Set<Client>();
  const stray: string[] = [];
  await watchQueries((client, args) => {
    const text = queryText(args).trim();
    if (/^begin\b/i.test(text)) inTransaction.add(client);
    else if (/^(commit|rollback)$/i.test(text)) inTransaction.delete(client);
    else if (inTransaction.size > 0 && !inTransaction.has(client)) stray.push(text);
    return undefined;
  }, fn);
  return stray;
}
