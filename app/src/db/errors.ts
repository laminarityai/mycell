// Recognizing Postgres errors, so feature code can turn a constraint it relies on into a typed
// error without knowing driver details.

/** True if `error` (or the error it wraps) is a unique violation of the named constraint. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    const pg = current as Error & { code?: unknown; constraint?: unknown };
    if (pg.code === "23505" && pg.constraint === constraint) return true;
  }
  return false;
}

/** True if `error` (or the error it wraps) is a foreign key violation of the named constraint. */
export function isForeignKeyViolation(error: unknown, constraint: string): boolean {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    const pg = current as Error & { code?: unknown; constraint?: unknown };
    if (pg.code === "23503" && pg.constraint === constraint) return true;
  }
  return false;
}
