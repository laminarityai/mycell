// Watching what a callback asks Postgres, for the query-budget and transaction helpers beside
// this file. Every query goes through a pg Client's `query`, the pool's and a transaction's alike,
// so they watch there.
import { Client } from "pg";

/**
 * Sees each query a pg Client sends: the client sending it, and the query's arguments (its text,
 * or a config with `text`, first). Returns what to do with the query's result, if anything.
 */
export type QueryWatcher = (
  client: Client,
  args: unknown[],
) => ((result: unknown) => void) | undefined;

/**
 * Runs `fn` with every query shown to `watch` before it's sent, until `fn` settles, even when it
 * throws. Anything else querying meanwhile is watched too: test files run one at a time, so keep
 * `fn` to what's being pinned.
 */
export async function watchQueries(watch: QueryWatcher, fn: () => Promise<unknown>): Promise<void> {
  const original: unknown = Reflect.get(Client.prototype, "query");
  if (typeof original !== "function") throw new Error("pg's Client has no query method.");
  const watching = function (this: Client, ...args: unknown[]): unknown {
    const read = watch(this, args);
    if (read === undefined) return Reflect.apply(original, this, args);
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
  Reflect.set(Client.prototype, "query", watching);
  try {
    await fn();
  } finally {
    Reflect.set(Client.prototype, "query", original);
  }
}

/** A query's SQL, from the arguments a Client's `query` got. */
export function queryText(args: unknown[]): string {
  const query = args.at(0);
  if (typeof query === "string") return query;
  if (typeof query === "object" && query !== null && "text" in query) {
    return typeof query.text === "string" ? query.text : "";
  }
  return "";
}
