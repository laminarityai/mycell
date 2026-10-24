// Gmail push (ADR-0026): a verified notification from Pub/Sub starts the poll of each connection
// on that mailbox, in the mailbox's own org, and nothing else.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, seedUser, type TwoOrgs } from "@/db/testing/two-org-fixture";
import type { Ctx } from "@/lib/ctx";
import { connectMailbox, daysAgo, deliver } from "@/testing/connect-helpers";
import { fakeGooglePush } from "@/testing/fake-google-push";
import { fakeInngest } from "@/testing/fake-inngest";
import { fakeNango } from "@/testing/fake-nango";
import { backfillConnection } from "../server";

beforeEach(resetDatabase);

const POLL_DUE = "discovery/connection.poll-due";

const polled = () => fakeInngest.sent(POLL_DUE).map((event) => event.data);

// A connection to `address` whose Gmail backfill finished, so its Gmail is `active`.
async function activeMailbox(ctx: Ctx, address: string, kind: "member" | "org" = "member") {
  const connection = await connectMailbox(
    ctx,
    address,
    [{ from: "alice@customer.example", to: [address], text: "Hi", at: daysAgo(1) }],
    kind,
  );
  await backfillConnection(ctx, connection.id);
  return connection;
}

// Org A and org B, each with a member's mailbox and a shared inbox, all active.
async function fourMailboxes() {
  const orgs = await seedTwoOrgs();
  const mailboxes = async ({ admin, member, workspaceDomain }: TwoOrgs["orgA"]) => ({
    member: await activeMailbox(member.ctx, member.email),
    inbox: await activeMailbox(admin.ctx, `support@${workspaceDomain}`, "org"),
  });
  return { ...orgs, a: await mailboxes(orgs.orgA), b: await mailboxes(orgs.orgB) };
}

describe("a verified notification", () => {
  it("starts the poll of a member's connection on that address", async () => {
    const { orgA, a } = await fourMailboxes();

    const response = await fakeGooglePush.notify(orgA.member.email);

    expect(response.status).toBe(204);
    expect(polled()).toEqual([{ orgId: orgA.id, connectionId: a.member.id }]);
  });

  it("starts the poll of an org connection on that address", async () => {
    const { orgA, a } = await fourMailboxes();

    const response = await fakeGooglePush.notify(`support@${orgA.workspaceDomain}`);

    expect(response.status).toBe(204);
    expect(polled()).toEqual([{ orgId: orgA.id, connectionId: a.inbox.id }]);
  });

  it("finds a member whose sign-in address is on a Workspace secondary domain", async () => {
    const { orgA } = await seedTwoOrgs();
    const pat = await seedUser(orgA.id, "pat@secondary-a.test", "member");
    const connection = await activeMailbox(pat.ctx, pat.email);

    expect((await fakeGooglePush.notify("Pat@Secondary-A.test")).status).toBe(204);

    expect(polled()).toEqual([{ orgId: orgA.id, connectionId: connection.id }]);
  });

  it("takes the history ID as a number or as a string", async () => {
    const { orgA, a } = await fourMailboxes();

    await fakeGooglePush.notify(orgA.member.email, { historyId: 98765 });
    await fakeGooglePush.notify(orgA.member.email, { historyId: "98766" });

    expect(polled()).toEqual([
      { orgId: orgA.id, connectionId: a.member.id },
      { orgId: orgA.id, connectionId: a.member.id },
    ]);
  });

  it("never reaches a connection in another org", async () => {
    const { orgA, orgB, a, b } = await fourMailboxes();

    for (const address of [orgB.member.email, `support@${orgB.workspaceDomain}`]) {
      expect((await fakeGooglePush.notify(address)).status).toBe(204);
    }

    expect(polled()).toEqual([
      { orgId: orgB.id, connectionId: b.member.id },
      { orgId: orgB.id, connectionId: b.inbox.id },
    ]);
    expect(polled().map((data) => data.connectionId)).not.toContain(a.member.id);
    expect(polled().map((data) => data.orgId)).not.toContain(orgA.id);
  });
});

describe("a notification that starts nothing", () => {
  let warned: unknown[][];
  beforeEach(() => {
    warned = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warned.push(args);
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is 204 for an address no org has, or no connection in its org", async () => {
    const { orgA } = await fourMailboxes();

    for (const address of ["someone@elsewhere.test", `nobody@${orgA.workspaceDomain}`]) {
      expect((await fakeGooglePush.notify(address)).status).toBe(204);
    }

    expect(polled()).toEqual([]);
  });

  it("is 204 for a connection needing reconnect", async () => {
    const { orgA, a } = await fourMailboxes();
    await deliver(fakeNango.authWebhook(a.member.nangoConnectionId, "refresh", false));

    expect((await fakeGooglePush.notify(orgA.member.email)).status).toBe(204);

    expect(polled()).toEqual([]);
  });

  it("is 204 for a connection whose Gmail is still backfilling", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectMailbox(orgA.member.ctx, orgA.member.email);

    expect((await fakeGooglePush.notify(orgA.member.email)).status).toBe(204);

    expect(polled()).toEqual([]);
  });

  it("is 204 for a malformed body, and logs it", async () => {
    const { orgA } = await fourMailboxes();
    const authorization = `Bearer ${await fakeGooglePush.token()}`;
    const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");
    const bodies = [
      "not json",
      JSON.stringify({ subscription: "projects/mycel-test/subscriptions/gmail-push" }),
      fakeGooglePush.wrap("%%% not base64 %%%"),
      fakeGooglePush.wrap(Buffer.from("not json").toString("base64")),
      fakeGooglePush.wrap(encoded({ emailAddress: orgA.member.email })),
      fakeGooglePush.wrap(encoded({ emailAddress: "not an address", historyId: 1 })),
    ];

    for (const body of bodies) {
      expect((await fakeGooglePush.post(body, authorization)).status).toBe(204);
    }

    expect(polled()).toEqual([]);
    expect(warned).toHaveLength(bodies.length);
    // What the log says names no address.
    expect(JSON.stringify(warned)).not.toContain(orgA.member.email);
  });
});

describe("an unverified notification", () => {
  it.each([
    ["no token", undefined],
    ["a token that isn't Bearer", "Basic dXNlcjpwYXNz"],
    ["a token that isn't a JWT", "Bearer not-a-jwt"],
  ])("is 401 with %s, and starts nothing", async (_, authorization) => {
    const { orgA } = await fourMailboxes();

    const response = await fakeGooglePush.post(
      fakeGooglePush.body(orgA.member.email),
      authorization,
    );

    expect(response.status).toBe(401);
    expect(polled()).toEqual([]);
  });

  it.each([
    ["a bad signature", { forged: true }],
    ["the wrong audience", { audience: "https://elsewhere.example/api/google/gmail-push" }],
    ["the wrong sender", { email: "someone-else@mycel-test.iam.gserviceaccount.com" }],
    ["a sender whose email isn't verified", { emailVerified: false }],
    ["an issuer other than Google", { issuer: "https://issuer.example" }],
    ["an expired token", { expired: true }],
  ])("is 401 with %s, and starts nothing", async (_, claims) => {
    const { orgA } = await fourMailboxes();

    const response = await fakeGooglePush.notify(orgA.member.email, { claims });

    expect(response.status).toBe(401);
    expect(polled()).toEqual([]);
  });
});
