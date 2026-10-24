// find_messages (#181): Ask Mycel finds messages in the person's own mail by sender, subject
// and date, from their headers only. It searches only a member connection the person owns,
// never a colleague's or an org inbox, and with none it says so and memory still answers. What
// it found is screened before the model reads it; the conversation keeps only pointers, and the
// page fetches the senders and subjects again to show them.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { tablesHolding } from "@/db/testing/content-scan";
import { seedTwoOrgs, seedUser } from "@/db/testing/two-org-fixture";
import { env } from "@/env";
import type { Ctx } from "@/lib/ctx";
import { DAY_MS } from "@/lib/time";
import { connectMailbox, daysAgo } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { fakeModelArmor } from "@/testing/fake-model-armor";
import { fakeNango } from "@/testing/fake-nango";
import { fundOrg, readTurn } from "@/testing/streamed-turn";
import { getConversation, startConversation, streamTurn } from "../server";
import { ORDERS, sentToModel, setupMemory } from "./memory-setup";

beforeEach(resetDatabase);

const BODY = "BODY-MARKER-5c1e please quote 30 oak chairs";
const SUBJECT = "SUBJECT-MARKER-91ab oak chairs";
const ADA = "Ada Lovelace <ada@acme.example>";

/** Org A, funded: the member's own mailbox holds a quote request from Ada and a lunch note. */
async function memberMail() {
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  await fundOrg(orgA.id);
  const own = await connectMailbox(orgA.member.ctx, orgA.member.email, [
    { from: ADA, subject: SUBJECT, text: BODY, at: daysAgo(3) },
    { from: "Bob <bob@other.example>", subject: "Lunch on Friday", text: "Pizza?", at: daysAgo(1) },
  ]);
  const ids = own.mailbox.list(new URLSearchParams()).messages?.map((m) => m.id) ?? [];
  return { ...orgs, own, lunchId: ids[0], quoteId: ids[1] };
}

/** A turn in which the agent calls each of `calls`, one step each, then answers. */
async function turnWith(ctx: Ctx, calls: { name: string; input: Record<string, unknown> }[]) {
  const { id } = await startConversation(ctx);
  const before = fakeAiGateway.requests("language").length;
  for (const call of calls) fakeAiGateway.reply({ toolCalls: [call] });
  fakeAiGateway.reply({ text: "Here's what I found." });
  const turn = await readTurn(await streamTurn(ctx, id, "Find Ada's message about chairs"));
  return { turn, id, sent: sentToModel(before) };
}

const find = (input: Record<string, unknown>) => ({ name: "find_messages", input });

/** The stored part of the conversation's last reply that called `tool`. */
async function storedPart(ctx: Ctx, id: string, tool: string) {
  const reply = (await getConversation(ctx, id)).messages.at(-1);
  return reply?.parts.find((part) => part.type === "tool" && part.toolName === tool);
}

/** The Gmail searches the fake Nango proxies, by Nango connection ID, while `run` runs. */
async function searchesDuring<T>(run: () => Promise<T>) {
  const searches: { connectionId: string; q: string | null }[] = [];
  fakeNango.beforeProxy((path, request) => {
    if (path === "/gmail/v1/users/me/messages") {
      searches.push({ connectionId: request.connectionId, q: request.query.get("q") });
    }
  });
  return { result: await run(), searches };
}

describe("find_messages", () => {
  it("finds the person's messages by sender, handing the model headers and never a body", async () => {
    const { orgA, own, quoteId } = await memberMail();

    const { sent, id } = await turnWith(orgA.member.ctx, [find({ from: "ada@acme.example" })]);

    expect(sent).toContain(SUBJECT);
    expect(sent).toContain("ada@acme.example");
    expect(sent).toContain(quoteId);
    expect(sent).not.toContain("Lunch on Friday");
    // Neither the body nor Gmail's snippet of it.
    expect(sent).not.toContain("BODY-MARKER-5c1e");
    expect(await storedPart(orgA.member.ctx, id, "find_messages")).toMatchObject({
      output: {
        connected: true,
        messages: [{ connectionId: own.id, sourceRef: quoteId }],
        screenedOut: 0,
      },
    });
  });

  it("keeps only pointers: no table holds the subject or the body", async () => {
    const { orgA } = await memberMail();

    await turnWith(orgA.member.ctx, [find({ subject: "oak chairs" })]);

    expect(await tablesHolding("SUBJECT-MARKER-91ab")).toEqual([]);
    expect(await tablesHolding("BODY-MARKER-5c1e")).toEqual([]);
    expect(await tablesHolding("ada@acme.example")).toEqual([]);
  });

  it("finds by subject and dates, searching for quotes and operators as plain words", async () => {
    const { orgA, own, quoteId } = await memberMail();
    const after = new Date(daysAgo(5).toISOString().slice(0, 10));
    const until = daysAgo(2).toISOString().slice(0, 10);

    const { result, searches } = await searchesDuring(() =>
      turnWith(orgA.member.ctx, [
        find({
          from: 'ada@acme.example" OR from:boss',
          subject: "Oak chairs",
          since: after.toISOString().slice(0, 10),
          until,
        }),
        find({ subject: 'chairs" OR (in:anywhere {label:secret})' }),
      ]),
    );

    const before = (Date.parse(until) + DAY_MS) / 1000;
    expect(searches).toEqual([
      {
        connectionId: own.nangoConnectionId,
        q: `from:"ada@acme.example or from boss" subject:"oak chairs" after:${String(after.getTime() / 1000)} before:${String(before)}`,
      },
      {
        connectionId: own.nangoConnectionId,
        q: 'subject:"chairs or in anywhere label secret"',
      },
    ]);
    // The quoted sender matched nothing; the operators found no other mail.
    expect(result.sent).not.toContain(quoteId);
    expect(await storedPart(orgA.member.ctx, result.id, "find_messages")).toMatchObject({
      output: { messages: [] },
    });
  });

  it("never searches a colleague's mailbox or an org inbox", async () => {
    const { orgA, own } = await memberMail();
    const { admin, member } = orgA;
    const colleague = await connectMailbox(admin.ctx, admin.email, [
      { from: ADA, subject: "Colleague's chairs", text: "Private", at: daysAgo(1) },
    ]);
    await connectMailbox(
      admin.ctx,
      `sales@${orgA.workspaceDomain}`,
      [{ from: ADA, subject: "Sales chairs", text: "Shared", at: daysAgo(1) }],
      "org",
    );

    const { result, searches } = await searchesDuring(() =>
      turnWith(member.ctx, [find({ from: "ada@acme.example" })]),
    );

    expect(searches.map((search) => search.connectionId)).toEqual([own.nangoConnectionId]);
    expect(result.sent).not.toContain("Colleague's chairs");
    expect(result.sent).not.toContain("Sales chairs");
    // The admin's own mail is theirs to search; the org inbox they can read never is.
    const asAdmin = await searchesDuring(() =>
      turnWith(admin.ctx, [find({ from: "ada@acme.example" })]),
    );
    expect(asAdmin.searches.map((search) => search.connectionId)).toEqual([
      colleague.nangoConnectionId,
    ]);
    expect(asAdmin.result.sent).toContain("Colleague's chairs");
    expect(asAdmin.result.sent).not.toContain("Sales chairs");
  });

  it("with no Google connection of their own, says so, and memory still answers", async () => {
    const { orgA } = await setupMemory();
    // Admins with an org inbox but no mailbox of their own, and a newcomer with nothing.
    const newcomer = await seedUser(orgA.id, `newcomer@${orgA.workspaceDomain}`, "member");
    const other = await seedUser(orgA.id, `admin2@${orgA.workspaceDomain}`, "admin");

    for (const ctx of [newcomer.ctx, other.ctx]) {
      const { result, searches } = await searchesDuring(() =>
        turnWith(ctx, [find({ from: "dana@acme.example" }), searchMemory("Dana")]),
      );

      expect(searches).toEqual([]);
      expect(result.sent).toContain("Connect Google");
      // Company-wide memory, from the sales inbox.
      expect(result.sent).toContain(ORDERS);
      expect(await storedPart(ctx, result.id, "find_messages")).toMatchObject({
        output: { connected: false },
      });
    }
  });

  it("drops a message whose sender or subject the screen flags, and the model never sees it", async () => {
    const { orgA, quoteId } = await memberMail();
    fakeModelArmor.flagText("Lunch on Friday");

    const { sent, id } = await turnWith(orgA.member.ctx, [find({})]);

    expect(sent).not.toContain("Lunch on Friday");
    expect(sent).toContain(SUBJECT);
    expect(sent).toContain("screenedOut");
    expect(await storedPart(orgA.member.ctx, id, "find_messages")).toMatchObject({
      output: { messages: [{ sourceRef: quoteId }], screenedOut: 1 },
    });
  });

  it("with no injection screen configured, says message search is unavailable and searches nothing", async () => {
    const { orgA } = await memberMail();
    const template = env.MODEL_ARMOR_TEMPLATE;
    env.MODEL_ARMOR_TEMPLATE = undefined;
    try {
      const { result, searches } = await searchesDuring(() =>
        turnWith(orgA.member.ctx, [find({ from: "ada@acme.example" })]),
      );

      expect(searches).toEqual([]);
      expect(result.sent).not.toContain(SUBJECT);
      expect(result.sent).toContain("unavailable");
    } finally {
      env.MODEL_ARMOR_TEMPLATE = template;
    }
  });
});

describe("the page's found messages", () => {
  it("shows each one's sender, subject and a link, fetched again, until it's gone from Gmail", async () => {
    const { orgA, own, quoteId } = await memberMail();
    const { id } = await turnWith(orgA.member.ctx, [find({ from: "ada@acme.example" })]);

    expect((await getConversation(orgA.member.ctx, id)).found.messages).toEqual([
      {
        connectionId: own.id,
        sourceRef: quoteId,
        from: ADA,
        subject: SUBJECT,
        receivedAt: expect.any(Date) as Date,
        href: `https://mail.google.com/mail/?authuser=${encodeURIComponent(orgA.member.email)}#all/${quoteId}`,
      },
    ]);

    own.mailbox.delete(quoteId);
    expect((await getConversation(orgA.member.ctx, id)).found.messages).toEqual([]);
  });
});

const searchMemory = (query: string) => ({ name: "search_memory", input: { query } });
