import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, type FixtureOrg } from "@/db/testing/two-org-fixture";
import { setRole } from "@/features/orgs/server";
import { connectGoogle, daysAgo } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import type { FakeMessageInput } from "@/testing/fake-gmail";
import { getConversation, startConversation, streamTurn } from "../server";
import { fundOrg, readTurn } from "./turn-helpers";

beforeEach(resetDatabase);

const pricingQuestion: FakeMessageInput = {
  from: "Dana <dana@customer.test>",
  subject: "Pricing for 40 seats",
  text: "Hi, what would 40 seats cost on the annual plan?",
  at: daysAgo(2),
};
const invoiceQuestion: FakeMessageInput = {
  from: "Lee <lee@customer.test>",
  subject: "Invoice copy",
  text: "Could you resend last month's invoice?",
  at: daysAgo(1),
};

/**
 * One turn in which the agent calls read_examples on `connectionId`, then answers. Returns the
 * request the model got after the call, as JSON, and the conversation's ID.
 */
async function readExamplesTurn(org: FixtureOrg, connectionId: string, ctx = org.admin.ctx) {
  await fundOrg(org.id);
  const { id } = await startConversation(ctx, {});
  fakeAiGateway.reply({
    toolCalls: [{ name: "read_examples", input: { connectionId, query: "pricing", limit: 5 } }],
  });
  fakeAiGateway.reply({ text: "I see." });
  const streamed = await readTurn(await streamTurn(ctx, id, "Look at a few pricing questions"));
  const next = JSON.stringify(fakeAiGateway.requests("language").at(-1)?.body);
  return { conversationId: id, next, streamed };
}

describe("read_examples", () => {
  it("returns an org connection's messages to the model in the next request", async () => {
    const { orgA } = await seedTwoOrgs();
    const inbox = await connectGoogle(orgA.admin.ctx, "support@org-a.test", {
      kind: "org",
      messages: [pricingQuestion, invoiceQuestion],
    });

    const { next } = await readExamplesTurn(orgA, inbox.id);

    for (const seen of [
      "dana@customer.test",
      "Pricing for 40 seats",
      "what would 40 seats cost on the annual plan?",
      "Invoice copy",
      "resend last month's invoice",
    ]) {
      expect(next).toContain(seen);
    }
  });

  it("is told the connection IDs it may read, and none of a member's", async () => {
    const { orgA } = await seedTwoOrgs();
    const own = await connectGoogle(orgA.admin.ctx, orgA.admin.email);
    const inbox = await connectGoogle(orgA.admin.ctx, "support@org-a.test", { kind: "org" });
    const members = await connectGoogle(orgA.member.ctx, orgA.member.email);
    await fundOrg(orgA.id);
    const { id } = await startConversation(orgA.admin.ctx, {});
    fakeAiGateway.reply({ text: "Hello." });

    await readTurn(await streamTurn(orgA.admin.ctx, id, "What can you read?"));

    const request = JSON.stringify(fakeAiGateway.requests("language").at(-1)?.body);
    expect(request).toContain(`read_examples can search the mail of: ${own.id}, ${inbox.id}.`);
    expect(request).not.toContain(members.id);
  });

  it("reads the admin's own connection", async () => {
    const { orgA } = await seedTwoOrgs();
    const own = await connectGoogle(orgA.admin.ctx, orgA.admin.email, {
      messages: [pricingQuestion],
    });

    const { next } = await readExamplesTurn(orgA, own.id);

    expect(next).toContain("Pricing for 40 seats");
  });

  it("finds no member's connection, nor another admin's own", async () => {
    const { orgA } = await seedTwoOrgs();
    const theirs = await connectGoogle(orgA.member.ctx, orgA.member.email, {
      messages: [pricingQuestion],
    });
    const expectNotFound = async () => {
      const { conversationId, next } = await readExamplesTurn(orgA, theirs.id);
      expect(next).toContain("That connection doesn't exist.");
      expect(next).not.toContain("Pricing for 40 seats");
      const reply = (await getConversation(orgA.admin.ctx, conversationId)).messages.at(-1);
      expect(reply?.parts).toContainEqual(
        expect.objectContaining({ toolName: "read_examples", isError: true }),
      );
    };

    await expectNotFound();
    // Made an admin, the member's own connection is still theirs alone (ADR-0001).
    await setRole(orgA.admin.ctx, orgA.member.id, "admin");
    await expectNotFound();
  });

  it("finds no connection of another org", async () => {
    const { orgA, orgB } = await seedTwoOrgs();
    const orgBInbox = await connectGoogle(orgB.admin.ctx, "support@org-b.test", {
      kind: "org",
      messages: [pricingQuestion],
    });

    const { next } = await readExamplesTurn(orgA, orgBInbox.id);

    expect(next).toContain("That connection doesn't exist.");
    expect(next).not.toContain("Pricing for 40 seats");
  });

  it("stores only the messages' source refs, never a subject, body or snippet", async () => {
    const { orgA } = await seedTwoOrgs();
    const inbox = await connectGoogle(orgA.admin.ctx, "support@org-a.test", {
      kind: "org",
      messages: [pricingQuestion, invoiceQuestion],
    });
    const ids = inbox.mailbox.list(new URLSearchParams()).messages?.map((m) => m.id) ?? [];

    const { conversationId } = await readExamplesTurn(orgA, inbox.id);

    const stored = await getConversation(orgA.admin.ctx, conversationId);
    const call = stored.messages.at(-1)?.parts.find((part) => part.type === "tool");
    expect(call).toMatchObject({
      toolName: "read_examples",
      isError: false,
      output: {
        connectionId: inbox.id,
        examples: ids.map((id) => ({ sourceRef: id, threadId: id })),
      },
    });
    const json = JSON.stringify(stored);
    for (const content of ["dana@", "Pricing for 40", "40 seats cost", "Invoice copy", "resend"]) {
      expect(json).not.toContain(content);
    }
  });

  it("streams only the messages' source refs to the page, as the conversation keeps them", async () => {
    const { orgA } = await seedTwoOrgs();
    const inbox = await connectGoogle(orgA.admin.ctx, "support@org-a.test", {
      kind: "org",
      messages: [pricingQuestion, invoiceQuestion],
    });
    const ids = inbox.mailbox.list(new URLSearchParams()).messages?.map((m) => m.id) ?? [];

    const { next, streamed } = await readExamplesTurn(orgA, inbox.id);

    expect(next).toContain("Pricing for 40 seats");
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(streamed.raw).toContain(id);
    for (const content of ["dana@", "Pricing for 40", "40 seats cost", "Invoice copy", "resend"]) {
      expect(streamed.raw).not.toContain(content);
    }
  });

  it("doesn't fetch the messages again when the conversation goes on", async () => {
    const { orgA } = await seedTwoOrgs();
    const inbox = await connectGoogle(orgA.admin.ctx, "support@org-a.test", {
      kind: "org",
      messages: [pricingQuestion],
    });
    const { conversationId } = await readExamplesTurn(orgA, inbox.id);
    fakeAiGateway.reply({ text: "Shall I draft it?" });

    await readTurn(await streamTurn(orgA.admin.ctx, conversationId, "Go on"));

    const next = JSON.stringify(fakeAiGateway.requests("language").at(-1)?.body);
    expect(next).toContain('"toolName":"read_examples"');
    expect(next).not.toContain("Pricing for 40 seats");
  });
});
