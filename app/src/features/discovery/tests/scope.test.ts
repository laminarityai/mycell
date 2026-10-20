// Owner scopes (ADR-0001): a member connection's events are its owner's alone, and an org
// connection's are admins'.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, type TwoOrgs } from "@/db/testing/two-org-fixture";
import { seedUserWithoutOrg } from "@/db/testing/seed-user";
import { signIn } from "@/features/orgs/server";
import { ForbiddenError } from "@/lib/errors";
import { backfillConnection, findEventsByObject } from "../server";
import { connectMailbox, daysAgo } from "@/testing/connect-helpers";

beforeEach(resetDatabase);

// Every mailbox in org A hears from the same customer.
const CUSTOMER = "alice@customer.example";

async function seedMailboxes({ orgA }: TwoOrgs) {
  const message = (to: string) => ({ from: CUSTOMER, to: [to], text: "Hello", at: daysAgo(1) });
  const inbox = `support@${orgA.workspaceDomain}`;
  const member = await connectMailbox(orgA.member.ctx, orgA.member.email, [
    message(orgA.member.email),
  ]);
  const admin = await connectMailbox(orgA.admin.ctx, orgA.admin.email, [message(orgA.admin.email)]);
  const org = await connectMailbox(orgA.admin.ctx, inbox, [message(inbox)], "org");
  await backfillConnection(orgA.member.ctx, member.id);
  await backfillConnection(orgA.admin.ctx, admin.id);
  await backfillConnection(orgA.admin.ctx, org.id);
  return { member, admin, org };
}

const connectionsOf = (events: { connectionId: string }[]) =>
  events.map((event) => event.connectionId).sort();

describe("findEventsByObject scopes", () => {
  it("shows a member only their own member connection's events", async () => {
    const orgs = await seedTwoOrgs();
    const { member } = await seedMailboxes(orgs);

    const found = await findEventsByObject(orgs.orgA.member.ctx, "email", CUSTOMER);

    expect(connectionsOf(found)).toEqual([member.id]);
    expect(found.map((event) => event.ownerScope)).toEqual(["member"]);
  });

  it("never shows a member another member's events", async () => {
    const orgs = await seedTwoOrgs();
    const { member } = await seedMailboxes(orgs);
    const bob = await seedUserWithoutOrg(`bob@${orgs.orgA.workspaceDomain}`);
    const bobCtx = await signIn({ userId: bob.id, hd: orgs.orgA.workspaceDomain });
    expect(await findEventsByObject(bobCtx, "email", CUSTOMER)).toEqual([]);

    const bobs = await connectMailbox(bobCtx, bob.email, [
      { from: CUSTOMER, to: [bob.email], text: "Hi Bob", at: daysAgo(1) },
    ]);
    await backfillConnection(bobCtx, bobs.id);

    expect(connectionsOf(await findEventsByObject(bobCtx, "email", CUSTOMER))).toEqual([bobs.id]);
    const members = await findEventsByObject(orgs.orgA.member.ctx, "email", CUSTOMER);
    expect(connectionsOf(members)).toEqual([member.id]);
  });

  it("shows an admin their own and org-connection events, but no member's", async () => {
    const orgs = await seedTwoOrgs();
    const { admin, org } = await seedMailboxes(orgs);

    const found = await findEventsByObject(orgs.orgA.admin.ctx, "email", CUSTOMER);

    expect(connectionsOf(found)).toEqual([admin.id, org.id].sort());
  });
});

describe("backfillConnection scopes", () => {
  it("refuses a connection that isn't the caller's to read", async () => {
    const { orgA } = await seedTwoOrgs();
    const members = await connectMailbox(orgA.member.ctx, orgA.member.email);
    const inbox = await connectMailbox(
      orgA.admin.ctx,
      `support@${orgA.workspaceDomain}`,
      [],
      "org",
    );

    await expect(backfillConnection(orgA.admin.ctx, members.id)).rejects.toThrow(ForbiddenError);
    await expect(backfillConnection(orgA.member.ctx, inbox.id)).rejects.toThrow(ForbiddenError);
  });
});
