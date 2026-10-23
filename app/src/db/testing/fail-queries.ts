// A database that fails on purpose, for a test that a database error reaches the error page
// rather than being read as something else (a source being unavailable, say).
import { Client } from "pg";

/**
 * Makes every query fail from now on, as when the database goes away, until the returned
 * function puts queries back. Every query goes through a pg Client's `query`, the pool's and a
 * transaction's alike (as countQueries counts them), so this fails them there. Test files run
 * one at a time, so put queries back before the test ends. With `after`, that many queries
 * still go through first: the database goes partway through what the test runs.
 */
export function failQueries({ after = 0 }: { after?: number } = {}): () => void {
  const original: unknown = Reflect.get(Client.prototype, "query");
  if (typeof original !== "function") throw new Error("pg's Client has no query method.");
  let left = after;
  const failing = function (this: Client, ...args: unknown[]): unknown {
    if (left > 0) {
      left -= 1;
      return Reflect.apply(original, this, args);
    }
    const error = new Error("The database is unavailable.");
    // The pool queries with a callback last; a transaction's client expects a promise.
    const callback = args.at(-1);
    if (typeof callback !== "function") return Promise.reject(error);
    setImmediate(() => {
      Reflect.apply(callback, undefined, [error]);
    });
    return undefined;
  };
  Reflect.set(Client.prototype, "query", failing);
  return () => Reflect.set(Client.prototype, "query", original);
}
