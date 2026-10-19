// The raw database client. Only src/db may import it; features use forOrg(ctx).
// The Drizzle client replaces this placeholder in the database foundation ticket.
export function getDb(): never {
  throw new Error("The database client is not set up yet.");
}
