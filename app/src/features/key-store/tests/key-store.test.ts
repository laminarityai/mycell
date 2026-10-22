import { inspect } from "node:util";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { tablesHolding } from "@/db/testing/content-scan";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { fakeKms } from "@/testing/fake-kms";
import { decryptForOrg, destroyOrgKey, encryptForOrg, hashForOrg } from "../server";

beforeEach(resetDatabase);
afterEach(() => {
  vi.restoreAllMocks();
});

/** The fake KMS's keys, oldest first, by state and the aliases naming them. */
function keyStates(): { state: string; aliases: string[] }[] {
  return fakeKms.listKeys().map(({ state, aliases }) => ({ state, aliases }));
}

it("encrypts for a company with a key made on first use, and decrypts it back", async () => {
  const { orgA } = await seedTwoOrgs();

  const encrypted = await encryptForOrg(orgA.member.ctx, "Hi Sam, your refund is on its way.");
  const again = await encryptForOrg(orgA.admin.ctx, "A second held send.");

  expect(encrypted).not.toContain("refund");
  expect(await decryptForOrg(orgA.admin.ctx, encrypted)).toBe("Hi Sam, your refund is on its way.");
  expect(await decryptForOrg(orgA.member.ctx, again)).toBe("A second held send.");
  expect(keyStates()).toEqual([{ state: "Enabled", aliases: [`alias/mycel/org/${orgA.id}`] }]);
});

it("keeps each company's data under its own key: another company can't decrypt it", async () => {
  const { orgA, orgB } = await seedTwoOrgs();

  const forA = await encryptForOrg(orgA.member.ctx, "Org A's held send");
  const forB = await encryptForOrg(orgB.member.ctx, "Org B's held send");

  await expect(decryptForOrg(orgB.admin.ctx, forA)).rejects.toThrow(NotFoundError);
  await expect(decryptForOrg(orgA.admin.ctx, forB)).rejects.toThrow(NotFoundError);
  expect(await decryptForOrg(orgB.member.ctx, forB)).toBe("Org B's held send");
  const keys = fakeKms.listKeys();
  expect(keys.map(({ aliases }) => aliases)).toEqual([
    [`alias/mycel/org/${orgA.id}`],
    [`alias/mycel/org/${orgB.id}`],
  ]);
  expect(fakeKms.dataKeyOwners()).toEqual(keys.map(({ keyId }) => keyId));
});

it("destroying a company's key makes its encrypted data unreadable, for good", async () => {
  const { orgA, orgB } = await seedTwoOrgs();
  const forA = await encryptForOrg(orgA.member.ctx, "Org A's held send");
  const forB = await encryptForOrg(orgB.member.ctx, "Org B's held send");

  await destroyOrgKey(systemCtx(orgA.id));

  await expect(decryptForOrg(orgA.admin.ctx, forA)).rejects.toThrow(NotFoundError);
  expect(keyStates()).toEqual([
    { state: "PendingDeletion", aliases: [] },
    { state: "Enabled", aliases: [`alias/mycel/org/${orgB.id}`] },
  ]);
  expect(await decryptForOrg(orgB.member.ctx, forB)).toBe("Org B's held send");
  // Encrypting again makes a new key, which doesn't open what the old one encrypted.
  expect(await decryptForOrg(orgA.admin.ctx, await encryptForOrg(orgA.admin.ctx, "New"))).toBe(
    "New",
  );
  await expect(decryptForOrg(orgA.admin.ctx, forA)).rejects.toThrow(NotFoundError);
});

it("makes one key for a company when two encryptions are its first at once", async () => {
  const { orgA } = await seedTwoOrgs();

  const [first, second] = await Promise.all([
    encryptForOrg(orgA.member.ctx, "First"),
    encryptForOrg(orgA.admin.ctx, "Second"),
  ]);

  expect(await decryptForOrg(orgA.admin.ctx, first)).toBe("First");
  expect(await decryptForOrg(orgA.member.ctx, second)).toBe("Second");
  // Both found no key and made one; the key that lost the alias goes unused.
  expect(keyStates().sort((a, b) => a.state.localeCompare(b.state))).toEqual([
    { state: "Enabled", aliases: [`alias/mycel/org/${orgA.id}`] },
    { state: "PendingDeletion", aliases: [] },
  ]);
});

it("never puts key material in a table, a log, or what it returns", async () => {
  const logged: unknown[] = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logged.push(...args);
    });
  }
  const { orgA, orgB } = await seedTwoOrgs();

  const encrypted = [
    await encryptForOrg(orgA.member.ctx, "Org A's held send"),
    await encryptForOrg(orgB.member.ctx, "Org B's held send"),
  ];
  await decryptForOrg(orgA.member.ctx, encrypted[0] ?? "");
  await expect(decryptForOrg(orgB.member.ctx, encrypted[0] ?? "")).rejects.toThrow(NotFoundError);
  const hashed = await hashForOrg(orgA.admin.ctx, "sam@client.example");
  await destroyOrgKey(systemCtx(orgA.id));

  // Two data keys and one hashing key, each in base64 and hex.
  const material = fakeKms.keyMaterial();
  expect(material).toHaveLength(6);
  const output = [...encrypted, hashed, ...logged.map((entry) => inspect(entry))].join("\n");
  for (const key of material) {
    expect(output).not.toContain(key);
    expect(await tablesHolding(key)).toEqual([]);
  }
});

it("lets only the org's system ctx destroy its key, never an admin or a member", async () => {
  const { orgA, orgB } = await seedTwoOrgs();
  const forA = await encryptForOrg(orgA.member.ctx, "Org A's held send");

  await expect(destroyOrgKey(orgA.member.ctx)).rejects.toThrow(ForbiddenError);
  await expect(destroyOrgKey(orgA.admin.ctx)).rejects.toThrow(ForbiddenError);
  expect(await decryptForOrg(orgA.member.ctx, forA)).toBe("Org A's held send");

  await destroyOrgKey(systemCtx(orgA.id));
  await destroyOrgKey(systemCtx(orgA.id));
  await destroyOrgKey(systemCtx(orgB.id));
  await expect(decryptForOrg(orgA.member.ctx, forA)).rejects.toThrow(NotFoundError);
  expect(keyStates()).toEqual([{ state: "PendingDeletion", aliases: [] }]);
});
