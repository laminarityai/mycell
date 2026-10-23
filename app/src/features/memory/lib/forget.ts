// Forgetting a person (ADR-0024): an admin gives an email address, and memory deletes the objects
// keyed by it. Each object's facts, those about it and those linking another object to it, go
// with it (the facts' foreign keys cascade), embeddings included, and migrations 0026 and 0032's
// triggers then remove each object left with no fact and relink any history. Source records stay:
// they're pointers to items, and what else an item taught is still true. The address goes on the
// do-not-learn list as a keyed hash (the key store), never in the clear: learning skips mail it
// sent, and drops any object keyed by it from what other items teach. The admin sees only how
// many facts went.
//
// An item already being learned may have checked the list before the address went on it, and
// store the person again. So forgetting also sends `memory/person.forgotten`, the address
// encrypted for the org, whose job shares learning's one-at-a-time-per-org key: it runs once the
// item in progress is stored, and deletes the objects keyed by the address again.
import { and, eq, inArray, or } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { decryptForOrg, encryptForOrg, hashForOrg } from "@/features/key-store/server";
import { type Ctx, requireAdmin, requireSystem } from "@/lib/ctx";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { forgetPersonSchema, type ForgetPersonInput, type Forgotten } from "../types";
import { sendPersonForgotten } from "./events";
import type { Extracted } from "./extract";
import { doNotLearn, facts, memoryObjects, objectKeys } from "./schema";

/**
 * Forgets the person with this address: deletes every object keyed by it with every fact about
 * it or linking to it, and puts a keyed hash of the address on the do-not-learn list. Returns
 * how many facts went. Admins only.
 */
export async function forgetPerson(ctx: Ctx, input: ForgetPersonInput): Promise<Forgotten> {
  requireAdmin(ctx);
  const parsed = forgetPersonSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Give the person's email address.");
  const address = parsed.data.email;
  // On the list first, so an item whose learning starts from now on skips them.
  await forOrg(ctx).insert(
    doNotLearn,
    { addressHash: await hashForOrg(ctx, address) },
    { onConflictDoNothing: true },
  );
  const forgotten = await deleteKeyedBy(ctx, address);
  await sendPersonForgotten(ctx.orgId, await encryptForOrg(ctx, address));
  return forgotten;
}

/**
 * Deletes the objects keyed by a forgotten address again, as `memory/person.forgotten`'s job:
 * whatever an item being learned stored meanwhile. Takes the address as `encryptForOrg` gave it;
 * once the org's key is gone, there's nothing to forget. The org's system ctx only.
 */
export async function forgetPersonAgain(ctx: Ctx, encryptedAddress: string): Promise<Forgotten> {
  requireSystem(ctx);
  let address: string;
  try {
    address = await decryptForOrg(ctx, encryptedAddress);
  } catch (error) {
    if (error instanceof NotFoundError) return { facts: 0 };
    throw error;
  }
  return deleteKeyedBy(ctx, address);
}

// Deletes the objects with the address as their email key, counting the facts about them or
// linking to them, which go with them.
async function deleteKeyedBy(ctx: Ctx, address: string): Promise<Forgotten> {
  return forOrg(ctx).transaction(async (tx) => {
    const keys = await tx.select(objectKeys, {
      where: and(eq(objectKeys.kind, "email"), eq(objectKeys.value, address)),
    });
    const ids = keys.map((key) => key.objectId);
    if (ids.length === 0) return { facts: 0 };
    const count = await tx.count(
      facts,
      or(inArray(facts.subjectId, ids), inArray(facts.objectId, ids)),
    );
    await tx.delete(memoryObjects, inArray(memoryObjects.id, ids));
    return { facts: count };
  });
}

/** How many people the org's do-not-learn list holds. */
export async function countForgotten(ctx: Ctx): Promise<number> {
  return forOrg(ctx).count(doNotLearn);
}

/**
 * Which of `addresses` (lowercased) are on the do-not-learn list. Nothing is hashed while the
 * list is empty.
 */
export async function forgottenAmong(ctx: Ctx, addresses: string[]): Promise<Set<string>> {
  const unique = [...new Set(addresses.map((address) => address.trim().toLowerCase()))];
  const db = forOrg(ctx);
  if (unique.length === 0 || (await db.count(doNotLearn)) === 0) return new Set();
  const hashes = await Promise.all(unique.map((address) => hashForOrg(ctx, address)));
  const listed = await db.select(doNotLearn, { where: inArray(doNotLearn.addressHash, hashes) });
  const found = new Set(listed.map((row) => row.addressHash));
  return new Set(unique.filter((_, i) => found.has(hashes[i] ?? "")));
}

/**
 * What an item teaches without the people on the do-not-learn list: no object keyed by a
 * forgotten address, no fact about one or linking to one, and no object only those facts used.
 */
export async function withoutForgotten(ctx: Ctx, extracted: Extracted): Promise<Extracted> {
  const emails = extracted.objects.flatMap((object) =>
    object.keys.flatMap((key) => (key.kind === "email" ? [key.value] : [])),
  );
  const forgotten = await forgottenAmong(ctx, emails);
  if (forgotten.size === 0) return extracted;
  const gone = new Set(
    extracted.objects
      .filter((object) => object.keys.some((key) => forgotten.has(key.value)))
      .map((object) => object.ref),
  );
  const kept = extracted.facts.filter(
    (fact) => !gone.has(fact.about) && (fact.object === null || !gone.has(fact.object)),
  );
  const used = new Set(kept.flatMap((fact) => [fact.about, fact.object ?? fact.about]));
  return { objects: extracted.objects.filter((object) => used.has(object.ref)), facts: kept };
}
