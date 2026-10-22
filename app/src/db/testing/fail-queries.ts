// A database that fails on purpose, for a test that a database error reaches the error page
// rather than being read as something else (a source being unavailable, say).
import { Client } from "pg";

/**
 * Makes every query fail from now on, as when the database goes away, until the returned
 * function puts queries back. Every query goes through a pg Client's `query`, the pool's and a
 * transaction's alike (as countQueries counts them), so this fails them there. Test files run
 * one at a time, so put queries back before the test ends.
 */
export function failQueries(): () => void {
  const original: unknown = Reflect.get(Client.prototype, "query");
  if (typeof original !== "function") throw new Error("pg's Client has no query method.");
  const failing = function (...args: unknown[]): unknown {
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
