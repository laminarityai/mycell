// A user row as Better Auth leaves it right after Google sign-in: no org yet. Tests of the
// sign-in function start from one.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { user } from "../auth-schema";
import { getDb } from "../client";

export type SeededUser = { id: string; email: string };

export async function seedUserWithoutOrg(email: string): Promise<SeededUser> {
  const id = randomUUID();
  await getDb().insert(user).values({ id, name: email, email, emailVerified: true });
  return { id, email };
}

/**
 * The user's row deleted and a new one made with `email` and a new ID, as Better Auth would
 * store a Google account deleted and re-created under the same address.
 */
export async function recreateUser(userId: string, email: string): Promise<SeededUser> {
  await getDb().delete(user).where(eq(user.id, userId));
  return seedUserWithoutOrg(email);
}

/** The user's address changed, keeping their ID, as when Workspace renames an account. */
export async function changeUserEmail(userId: string, email: string): Promise<void> {
  await getDb().update(user).set({ email, name: email }).where(eq(user.id, userId));
}
