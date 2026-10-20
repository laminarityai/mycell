// Signed-in sessions as Better Auth stores them. Tests that end a user's access check them
// here, and e2e tests sign a browser in with the returned token (e2e/sign-in-as.ts), because
// Better Auth's own session reads need a signed cookie.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { session } from "../auth-schema";
import { getDb } from "../client";

/** Stores a session for the user that is valid for an hour, and returns its token. */
export async function seedSession(userId: string): Promise<string> {
  const token = randomUUID();
  await getDb()
    .insert(session)
    .values({
      id: randomUUID(),
      token,
      userId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      updatedAt: new Date(),
    });
  return token;
}

export async function hasSession(userId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: session.id })
    .from(session)
    .where(eq(session.userId, userId));
  return rows.length > 0;
}
