// A user row as Better Auth leaves it right after Google sign-in: no org yet. Tests of the
// sign-in function start from one.
import { randomUUID } from "node:crypto";
import { user } from "../auth-schema";
import { getDb } from "../client";

export type SeededUser = { id: string; email: string };

export async function seedUserWithoutOrg(email: string): Promise<SeededUser> {
  const id = randomUUID();
  await getDb().insert(user).values({ id, name: email, email, emailVerified: true });
  return { id, email };
}
