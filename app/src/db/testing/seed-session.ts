// Signed-in sessions as Better Auth stores them. Tests that end a user's access check them
// here, because Better Auth's own session reads need a signed cookie.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { session } from "../auth-schema";
import { getDb } from "../client";

export async function seedSession(userId: string): Promise<void> {
  await getDb()
    .insert(session)
    .values({
      id: randomUUID(),
      token: randomUUID(),
      userId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      updatedAt: new Date(),
    });
}

export async function hasSession(userId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: session.id })
    .from(session)
    .where(eq(session.userId, userId));
  return rows.length > 0;
}
