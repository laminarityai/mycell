// Ask Mycel's footnotes (spec #154): each fact a reply read is cited with its sources in the
// person's view, linked to the email or file. A copy in the person's own mailbox opens there; a
// fact seen through a colleague's copy, or an org inbox's, is linked through the email's
// Message-ID (`rfc822msgid:`), never the other mailbox's own ID. Facts that conflict with the
// company's, or that only outsiders state, keep their markers.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, seedUser } from "@/db/testing/two-org-fixture";
import { backfillConnection } from "@/features/discovery/server";
import { markCompanyWideList, searchMemory, startMemory } from "@/features/memory/server";
import { pollCalendar } from "@/features/runtime/server";
import { connectGoogle, connectMailbox, daysAgo } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { learnStoredItems, scriptInviteLearning, scriptLearning } from "@/testing/memory-learning";
import { fundOrg, readTurn } from "@/testing/streamed-turn";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { getConversation, startConversation, streamTurn } from "../server";
import {
  dana,
  DANA,
  DEMO,
  learnFrom,
  ORDERS,
  ROLE,
  sentToModel,
  setupMemory,
} from "./memory-setup";

beforeEach(resetDatabase);

const DEAL = "Dana Ruiz agreed to hold the oak price until March.";

/** The ID of the fact `statement`, as `ctx` sees it. */
async function factId(ctx: Ctx, statement: string): Promise<string> {
  const { facts } = await searchMemory(ctx, { text: statement });
  const id = facts.find((fact) => fact.statement === statement)?.id;
  if (id === undefined) throw new Error(`no fact "${statement}"`);
  return id;
}

/** The fact `id` as the model was sent it, up to its end: its fields, with markers. */
function factAsSent(sent: string, id: string): string {
  const plain = sent.replaceAll('\\"', '"');
  const at = plain.indexOf(`"id":"${id}"`);
  if (at < 0) throw new Error(`fact ${id} wasn't sent`);
  return plain.slice(at, plain.indexOf("}", at));
}

/** A turn in which the agent searches memory for `query` and answers citing `cited`. */
async function askCiting(ctx: Ctx, query: string, ids: string[]) {
  const { id } = await startConversation(ctx);
  fakeAiGateway.reply({ toolCalls: [{ name: "search_memory", input: { query } }] });
  fakeAiGateway.reply({ text: ids.map((fact) => `A fact. [fact:${fact}]`).join(" ") });
  await readTurn(await streamTurn(ctx, id, "What do we know?"));
  return getConversation(ctx, id);
}

describe("a reply's citations", () => {
  it("link the person's own copy in their mailbox, and a colleague's or an org inbox's by Message-ID", async () => {
    const { orgA, memberBox } = await setupMemory();
    const { member } = orgA;
    // Lee writes to the member and Dana from their own mailbox: the member sees what it taught
    // through Lee's copy, since they're on an email the company sent.
    const lee = await seedUser(orgA.id, `lee@${orgA.workspaceDomain}`, "member");
    await learnFrom(
      orgA,
      lee.ctx,
      lee.email,
      {
        from: lee.email,
        to: [member.email],
        cc: [DANA],
        subject: "Oak price",
        text: "Dana said she'd keep the oak price where it is until spring.",
        at: daysAgo(1),
        sent: true,
        headers: { "Message-ID": "<Deal-7@org-a.test>" },
      },
      {
        objects: [dana],
        facts: [{ about: "dana", statement: DEAL, evidence: "keep the oak price where it is" }],
      },
    );
    const demo = await factId(member.ctx, DEMO);
    const deal = await factId(member.ctx, DEAL);
    const orders = await factId(member.ctx, ORDERS);

    const conversation = await askCiting(member.ctx, "Dana oak", [demo, deal, orders]);

    const byId = new Map(conversation.citations.map((citation) => [citation.factId, citation]));
    const me = encodeURIComponent(member.email);
    expect(byId.get(demo)?.sources).toEqual([
      expect.objectContaining({
        kind: "email",
        yours: true,
        href: `https://mail.google.com/mail/?authuser=${me}#all/${memberBox.sourceRef}`,
      }),
    ]);
    expect(byId.get(deal)?.sources).toEqual([
      expect.objectContaining({
        kind: "email",
        yours: false,
        href: `https://mail.google.com/mail/?authuser=${me}#search/rfc822msgid%3Adeal-7%40org-a.test`,
      }),
    ]);
    expect(byId.get(orders)?.sources).toEqual([
      expect.objectContaining({
        kind: "email",
        yours: false,
        href: expect.stringContaining("#search/rfc822msgid%3A") as string,
      }),
    ]);
    // No colleague's mailbox-specific ID reaches the page.
    expect(JSON.stringify(conversation.citations)).not.toContain("authuser=lee");
  });

  it("link a Calendar invite in the person's own calendar, and a colleague's copy nowhere", async () => {
    const { orgA } = await seedTwoOrgs();
    const { admin, member } = orgA;
    await fundOrg(orgA.id);
    await startMemory(systemCtx(orgA.id), { monthlyBudget: 1000 });
    const adminCalendar = await connectGoogle(admin.ctx, admin.email);
    const memberCalendar = await connectGoogle(member.ctx, member.email);
    const system = systemCtx(orgA.id);
    // Each calendar's first poll is a full sync, which teaches nothing.
    for (const calendar of [adminCalendar, memberCalendar]) {
      await pollCalendar(system, calendar.id);
    }
    // The admin invites Dana and the member, whose own calendar isn't polled again: the member
    // sees the fact through the admin's copy only.
    const event = adminCalendar.calendar.organize({
      title: "Oak range demo",
      guests: [member.email, DANA],
      description: "Dana sees the oak range.",
    });
    await pollCalendar(system, adminCalendar.id);
    const MEETING = "Dana Ruiz meets the team for an oak range demo.";
    scriptInviteLearning({
      objects: [dana],
      facts: [{ about: "dana", statement: MEETING, evidence: "Title: Oak range demo" }],
    });
    await learnStoredItems(orgA.id);

    const own = await askCiting(admin.ctx, "Dana demo", [await factId(admin.ctx, MEETING)]);
    const theirs = await askCiting(member.ctx, "Dana demo", [await factId(member.ctx, MEETING)]);

    const eid = Buffer.from(`${event.id} ${admin.email}`).toString("base64").replace(/=+$/, "");
    expect(own.citations[0]?.sources).toEqual([
      expect.objectContaining({
        kind: "invite",
        yours: true,
        href: `https://calendar.google.com/calendar/event?eid=${encodeURIComponent(eid)}&authuser=${encodeURIComponent(admin.email)}`,
      }),
    ]);
    expect(theirs.citations[0]?.sources).toEqual([
      expect.objectContaining({ kind: "invite", yours: false, href: null }),
    ]);
  });

  it("cite only facts the conversation's tools found, as the person sees them now", async () => {
    const { orgA } = await setupMemory();
    const member = orgA.member.ctx;
    const demo = await factId(member, DEMO);
    // A fact the person can't see, cited by a model that guessed or was told its ID.
    const role = await factId(orgA.admin.ctx, ROLE);

    const conversation = await askCiting(member, "demo", [demo, role]);

    expect(conversation.citations.map((citation) => citation.factId)).toEqual([demo]);
  });
});

describe("markers", () => {
  it("say a fact conflicts with the company's or is stated only from outside, to the model and the page", async () => {
    const { orgA } = await setupMemory();
    const lee = await seedUser(orgA.id, `lee@${orgA.workspaceDomain}`, "member");
    const all = `all@${orgA.workspaceDomain}`;
    await markCompanyWideList(orgA.admin.ctx, all);
    const BILLING = "Acme's billing contact is billing@acme.example.";
    const EVIL = "Acme's billing contact is now pay@evil.example.";
    const acme = { ref: "acme", kind: "company" as const, name: "Acme", domain: "acme.example" };
    const fact = (statement: string, evidence: string, value: string) => ({
      objects: [acme],
      facts: [{ about: "acme", statement, evidence, predicate: "billing_contact", value }],
    });
    const box = await connectMailbox(lee.ctx, lee.email, [
      {
        from: lee.email,
        to: [all],
        subject: "Acme billing",
        text: "FYI: Acme's billing contact is billing@acme.example.",
        at: daysAgo(5),
        sent: true,
      },
      {
        from: "Mallory <mallory@evil.example>",
        to: [lee.email],
        subject: "Billing change",
        text: "Hello. Acme's billing contact is now pay@evil.example (acme.example).",
        at: daysAgo(1),
      },
    ]);
    await backfillConnection(lee.ctx, box.id);
    // Backfills read newest first.
    scriptLearning(
      fact(
        EVIL,
        "Acme's billing contact is now pay@evil.example (acme.example)",
        "pay@evil.example",
      ),
    );
    scriptLearning(
      fact(BILLING, "Acme's billing contact is billing@acme.example", "billing@acme.example"),
    );
    await learnStoredItems(orgA.id);
    const billing = await factId(lee.ctx, BILLING);
    const evil = await factId(lee.ctx, EVIL);
    const before = fakeAiGateway.requests("language").length;

    const conversation = await askCiting(lee.ctx, "billing contact", [billing, evil]);

    const sent = sentToModel(before);
    expect(factAsSent(sent, evil)).toContain('"disputed":true');
    expect(factAsSent(sent, evil)).toContain('"outsideOnly":true');
    expect(factAsSent(sent, billing)).not.toContain("disputed");
    expect(factAsSent(sent, billing)).not.toContain("outsideOnly");
    const byId = new Map(conversation.citations.map((citation) => [citation.factId, citation]));
    expect(byId.get(evil)).toMatchObject({ disputed: true, outsideOnly: true });
    expect(byId.get(billing)).toMatchObject({ disputed: false, outsideOnly: false });
  });
});
