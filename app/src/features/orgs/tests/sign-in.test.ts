import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { WorkspaceAccountRequiredError } from "@/lib/errors";
import { seedUserWithoutOrg } from "@/db/testing/seed-user";
import { listUsers, signIn } from "../server";

beforeEach(resetDatabase);

describe("signIn", () => {
  it("creates the org for the first user of a Workspace domain and makes them its admin", async () => {
    const ada = await seedUserWithoutOrg("ada@acme.test");

    const ctx = await signIn({ userId: ada.id, hd: "acme.test" });

    expect(ctx).toMatchObject({ userId: ada.id, role: "admin" });
    expect(await listUsers(ctx)).toEqual([
      { id: ada.id, name: "ada@acme.test", email: "ada@acme.test", role: "admin" },
    ]);
  });

  it("adds a later user of the same domain to that org as a member", async () => {
    const ada = await seedUserWithoutOrg("ada@acme.test");
    const bob = await seedUserWithoutOrg("bob@acme.test");
    const adaCtx = await signIn({ userId: ada.id, hd: "acme.test" });

    const bobCtx = await signIn({ userId: bob.id, hd: "acme.test" });

    expect(bobCtx).toEqual({ orgId: adaCtx.orgId, userId: bob.id, role: "member" });
    expect(await listUsers(adaCtx)).toEqual([
      { id: ada.id, name: "ada@acme.test", email: "ada@acme.test", role: "admin" },
      { id: bob.id, name: "bob@acme.test", email: "bob@acme.test", role: "member" },
    ]);
  });

  it("turns away a personal Google account, which has no hd claim", async () => {
    const pat = await seedUserWithoutOrg("pat@gmail.test");

    await expect(signIn({ userId: pat.id, hd: undefined })).rejects.toThrow(
      WorkspaceAccountRequiredError,
    );
  });

  it("lands a returning user back in their org with their current role, changing nothing", async () => {
    const ada = await seedUserWithoutOrg("ada@acme.test");
    const bob = await seedUserWithoutOrg("bob@acme.test");
    const adaCtx = await signIn({ userId: ada.id, hd: "acme.test" });
    const bobCtx = await signIn({ userId: bob.id, hd: "acme.test" });
    const usersBefore = await listUsers(adaCtx);

    expect(await signIn({ userId: ada.id, hd: "acme.test" })).toEqual(adaCtx);
    expect(await signIn({ userId: bob.id, hd: "acme.test" })).toEqual(bobCtx);
    expect(await listUsers(adaCtx)).toEqual(usersBefore);
  });

  it("creates exactly one org when two first users of a domain sign in at once", async () => {
    // Many pairs race at once, so a losing insert regularly meets the winner's row in flight.
    const domains = Array.from({ length: 20 }, (_, i) => `race-${String(i)}.test`);
    const pairs = await Promise.all(
      domains.map(async (domain) => ({
        domain,
        ada: await seedUserWithoutOrg(`ada@${domain}`),
        bob: await seedUserWithoutOrg(`bob@${domain}`),
      })),
    );

    const results = await Promise.all(
      pairs.map(({ domain, ada, bob }) =>
        Promise.all([
          signIn({ userId: ada.id, hd: domain }),
          signIn({ userId: bob.id, hd: domain }),
        ]),
      ),
    );

    for (const [adaCtx, bobCtx] of results) {
      expect(bobCtx.orgId).toBe(adaCtx.orgId);
      expect([adaCtx.role, bobCtx.role].sort()).toEqual(["admin", "member"]);
      const users = await listUsers(adaCtx);
      expect(users.map((u) => u.role).sort()).toEqual(["admin", "member"]);
    }
  });
});
