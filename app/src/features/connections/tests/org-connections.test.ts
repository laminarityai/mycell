import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { removeUser, setRole } from "@/features/orgs/server";
import { ForbiddenError } from "@/lib/errors";
import { fakeNango } from "@/testing/fake-nango";
import { handleNangoWebhook, listConnections, startConnect } from "../server";
import { connectGmail, connectOrgInbox } from "@/testing/connect-helpers";

beforeEach(resetDatabase);

describe("connecting an org inbox", () => {
  it("records an in-domain address as an org connection that admins see", async () => {
    const { orgA } = await seedTwoOrgs();
    const support = `support@${orgA.workspaceDomain}`;

    const { response } = await connectOrgInbox(orgA.admin.ctx, support);

    expect(response).toEqual({ status: 200 });
    const listing = await listConnections(orgA.admin.ctx);
    expect(listing.attempts).toEqual([]);
    expect(listing.connections).toEqual([]);
    expect(listing.orgConnections).toEqual([
      expect.objectContaining({
        source: "gmail",
        kind: "org",
        accountEmail: support,
        status: "backfilling",
        owner: { userId: orgA.admin.id, removed: false, name: orgA.admin.email },
      }),
    ]);
  });

  it("matches the Workspace domain case-insensitively", async () => {
    const { orgA } = await seedTwoOrgs();

    await connectOrgInbox(orgA.admin.ctx, `Support@${orgA.workspaceDomain.toUpperCase()}`);

    const { orgConnections } = await listConnections(orgA.admin.ctx);
    expect(orgConnections.map((c) => c.accountEmail)).toEqual([`support@${orgA.workspaceDomain}`]);
  });

  it("refuses a member starting one, recording nothing", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(startConnect(orgA.member.ctx, "gmail", "org")).rejects.toThrow(ForbiddenError);

    const listing = await listConnections(orgA.member.ctx);
    expect(listing.attempts).toEqual([]);
    expect(listing.connections).toEqual([]);
  });

  it.each([
    ["a personal account", "someone@gmail.com"],
    ["a domain that only ends like ours", "support@notorg-a.test"],
    ["a subdomain", "support@mail.org-a.test"],
  ])("refuses %s, says why, and revokes it at Nango", async (_, address) => {
    const { orgA } = await seedTwoOrgs();

    const { connectionId } = await connectOrgInbox(orgA.admin.ctx, address);

    const listing = await listConnections(orgA.admin.ctx);
    expect(listing.orgConnections).toEqual([]);
    expect(listing.attempts).toEqual([expect.objectContaining({ kind: "org", status: "refused" })]);
    expect(listing.attempts[0]?.refusal).toContain(`@${orgA.workspaceDomain}`);
    expect(listing.attempts[0]?.refusal).toContain(address);
    expect(fakeNango.hasConnection(connectionId)).toBe(false);
  });

  it("refuses an in-domain address of another org's domain", async () => {
    const { orgA, orgB } = await seedTwoOrgs();

    await connectOrgInbox(orgA.admin.ctx, `support@${orgB.workspaceDomain}`);

    const listing = await listConnections(orgA.admin.ctx);
    expect(listing.orgConnections).toEqual([]);
    expect(listing.attempts.map((a) => a.status)).toEqual(["refused"]);
  });

  it("refuses an attempt whose admin was demoted before it settled", async () => {
    const { orgA } = await seedTwoOrgs();
    const promoted = { ...orgA.member.ctx, role: "admin" as const };
    await setRole(orgA.admin.ctx, orgA.member.id, "admin");
    const { token } = await startConnect(promoted, "gmail", "org");
    await setRole(orgA.admin.ctx, orgA.member.id, "member");
    const webhook = fakeNango.completeConnect(token, {
      emailAddress: `support@${orgA.workspaceDomain}`,
    });

    await handleNangoWebhook(webhook.rawBody, webhook.headers);

    expect((await listConnections(orgA.admin.ctx)).orgConnections).toEqual([]);
    const { attempts } = await listConnections(orgA.member.ctx);
    expect(attempts).toEqual([
      expect.objectContaining({
        status: "refused",
        refusal: "Only admins can connect org sources.",
      }),
    ]);
    expect(fakeNango.hasConnection(webhook.connectionId)).toBe(false);
  });

  it("refuses connecting the same shared inbox twice", async () => {
    const { orgA } = await seedTwoOrgs();
    const support = `support@${orgA.workspaceDomain}`;
    await connectOrgInbox(orgA.admin.ctx, support);

    const second = await connectOrgInbox(orgA.admin.ctx, support);

    const listing = await listConnections(orgA.admin.ctx);
    expect(listing.orgConnections).toHaveLength(1);
    expect(listing.attempts).toEqual([
      expect.objectContaining({ status: "refused", refusal: `${support} is already connected.` }),
    ]);
    expect(fakeNango.hasConnection(second.connectionId)).toBe(false);
  });
});

describe("listing connections by role", () => {
  it("shows an admin other members' connections as metadata only", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGmail(orgA.member.ctx, orgA.member.email);
    await connectGmail(orgA.admin.ctx, orgA.admin.email);

    const listing = await listConnections(orgA.admin.ctx);

    expect(listing.connections.map((c) => c.accountEmail)).toEqual([orgA.admin.email]);
    expect(listing.memberConnections).toEqual([
      {
        id: expect.any(String) as string,
        source: "gmail",
        status: "backfilling",
        owner: { userId: orgA.member.id, removed: false, name: orgA.member.email },
        createdAt: expect.any(Date) as Date,
      },
    ]);
  });

  it("shows a member only their own connections, never org connections or anyone else's", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGmail(orgA.member.ctx, orgA.member.email);
    await connectGmail(orgA.admin.ctx, orgA.admin.email);
    await connectOrgInbox(orgA.admin.ctx, `support@${orgA.workspaceDomain}`);

    const listing = await listConnections(orgA.member.ctx);

    expect(listing.connections.map((c) => c.accountEmail)).toEqual([orgA.member.email]);
    expect(listing.orgConnections).toEqual([]);
    expect(listing.memberConnections).toEqual([]);
  });

  it("keeps an org connection whose owner was removed, flagged", async () => {
    const { orgA } = await seedTwoOrgs();
    const support = `support@${orgA.workspaceDomain}`;
    await setRole(orgA.admin.ctx, orgA.member.id, "admin");
    await connectOrgInbox({ ...orgA.member.ctx, role: "admin" }, support);

    await removeUser(orgA.admin.ctx, orgA.member.id);

    const { orgConnections } = await listConnections(orgA.admin.ctx);
    expect(orgConnections).toEqual([
      expect.objectContaining({
        accountEmail: support,
        status: "backfilling",
        owner: { userId: orgA.member.id, removed: true },
      }),
    ]);
  });

  it("shows a demoted admin's org connection to admins only, not to its owner", async () => {
    const { orgA } = await seedTwoOrgs();
    await setRole(orgA.admin.ctx, orgA.member.id, "admin");
    const promoted = { ...orgA.member.ctx, role: "admin" as const };
    await connectOrgInbox(promoted, `support@${orgA.workspaceDomain}`);

    await setRole(orgA.admin.ctx, orgA.member.id, "member");

    const theirs = await listConnections(orgA.member.ctx);
    expect(theirs.connections).toEqual([]);
    expect(theirs.orgConnections).toEqual([]);
    const admins = await listConnections(orgA.admin.ctx);
    expect(admins.orgConnections.map((c) => c.owner)).toEqual([
      { userId: orgA.member.id, removed: false, name: orgA.member.email },
    ]);
  });
});
