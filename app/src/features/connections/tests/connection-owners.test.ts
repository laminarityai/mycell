// Who owns each connection, and source clients for several connections at once: what a list of
// things that ran on many connections (the Runs page) reads, in the same queries however many
// connections there are.
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { countQueries } from "@/db/testing/count-queries";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { connectMailbox } from "@/testing/connect-helpers";
import { connectionOwners, sourceClients } from "../server";

beforeEach(resetDatabase);

const profile = z.object({ emailAddress: z.string() });
const PROFILE = "/gmail/v1/users/me/profile";

// Org A's admin and member each connect their own Gmail, and the admin a shared inbox.
async function threeConnections() {
  const { orgA } = await seedTwoOrgs();
  const own = await connectMailbox(orgA.admin.ctx, orgA.admin.email);
  const colleague = await connectMailbox(orgA.member.ctx, orgA.member.email);
  const shared = `sales@${orgA.workspaceDomain}`;
  const org = await connectMailbox(orgA.admin.ctx, shared, [], "org");
  return { orgA, own, colleague, org, shared };
}

describe("connectionOwners", () => {
  it("names a colleague's connection by its owner alone for an admin, and reads the rest in full", async () => {
    const { orgA, own, colleague, org, shared } = await threeConnections();

    const owners = await connectionOwners(orgA.admin.ctx);

    expect(owners).toEqual(
      expect.arrayContaining([
        {
          id: own.id,
          kind: "member",
          readable: true,
          accountEmail: orgA.admin.email,
          owner: { userId: orgA.admin.id, removed: false, name: orgA.admin.email },
        },
        {
          id: colleague.id,
          kind: "member",
          readable: false,
          accountEmail: null,
          owner: { userId: orgA.member.id, removed: false, name: orgA.member.email },
        },
        {
          id: org.id,
          kind: "org",
          readable: true,
          accountEmail: shared,
          owner: { userId: orgA.admin.id, removed: false, name: orgA.admin.email },
        },
      ]),
    );
    expect(owners).toHaveLength(3);
  });

  it("gives a member only their own connections", async () => {
    const { orgA, colleague } = await threeConnections();

    expect(await connectionOwners(orgA.member.ctx)).toEqual([
      expect.objectContaining({ id: colleague.id, readable: true }),
    ]);
  });

  it("reads the same queries for 1 connection as for 3", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectMailbox(orgA.admin.ctx, orgA.admin.email);
    const one = await countQueries(() => connectionOwners(orgA.admin.ctx));
    await connectMailbox(orgA.member.ctx, orgA.member.email);
    await connectMailbox(orgA.admin.ctx, `sales@${orgA.workspaceDomain}`, [], "org");

    const three = await countQueries(() => connectionOwners(orgA.admin.ctx));

    expect(three.queries).toBe(one.queries);
  });
});

describe("sourceClients", () => {
  it("opens a client for each connection the caller may read, in one query", async () => {
    const { orgA, own, colleague, org, shared } = await threeConnections();
    let clients: Awaited<ReturnType<typeof sourceClients>> = new Map();

    const opened = await countQueries(async () => {
      clients = await sourceClients(orgA.admin.ctx, [own.id, colleague.id, org.id]);
    });

    expect(opened.queries).toBe(1);
    expect([...clients.keys()].sort()).toEqual([own.id, org.id].sort());
    expect(await clients.get(org.id)?.get(PROFILE, profile)).toEqual({ emailAddress: shared });
  });

  it("opens none for a member's colleague's or the org's connections", async () => {
    const { orgA, own, org } = await threeConnections();

    expect(await sourceClients(orgA.member.ctx, [own.id, org.id])).toEqual(new Map());
    expect(await sourceClients(orgA.member.ctx, [])).toEqual(new Map());
  });
});
