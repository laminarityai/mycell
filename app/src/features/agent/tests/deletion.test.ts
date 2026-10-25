// An Ask Mycel reply goes when the data it drew on goes (invariant 3, spec #154, #185). Each
// reply records the connections it drew on and the facts it read, in rows that cascade with
// them, and losing any of those rows replaces the reply with a tombstone: the conversation keeps
// its order and says something was removed, and none of the reply's words stay. So every way a
// connection or a fact is deleted reaches the replies, with nothing in each path.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tablesHolding } from "@/db/testing/content-scan";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, seedUser } from "@/db/testing/two-org-fixture";
import { deleteMemberConnectionsOf, disconnect } from "@/features/connections/server";
import { backfillConnection, pollConnection } from "@/features/discovery/server";
import {
  applyRetention,
  deleteRemovedItem,
  deleteToldFact,
  forgetPerson,
  purgeDeletedToldFacts,
  readObject,
  setRetentionWindow,
  startMemory,
} from "@/features/memory/server";
import { TOLD_UNDO_MINUTES } from "@/features/memory/types";
import { removeUser } from "@/features/orgs/server";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { setNow } from "@/lib/time";
import { connectMailbox, daysAgo } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { learnStoredItems, scriptLearning, scriptTelling } from "@/testing/memory-learning";
import { fundOrg, readTurn } from "@/testing/streamed-turn";
import { getConversation, listConversations, startConversation, streamTurn } from "../server";
import { AskMycel } from "../ui";
import { DANA, dana, learned, learnFrom, setupMemory } from "./memory-setup";

// The chat page reads the router; a static render has none.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

beforeEach(resetDatabase);

const REMOVED = [{ type: "removed" }];
const TOLD_NOTE = "Dana Ruiz prefers a call to an email.";

/** One turn: the agent reads what memory knows about `email`, then answers `answer`. */
async function askAbout(ctx: Ctx, conversationId: string, email: string, answer: string) {
  fakeAiGateway.reply({ toolCalls: [{ name: "read_object", input: { email } }] });
  fakeAiGateway.reply({ text: answer });
  await readTurn(await streamTurn(ctx, conversationId, `Tell me about ${email}`));
}

/** A conversation whose one reply read what memory knows about Dana. */
async function askedAboutDana(ctx: Ctx, answer: string): Promise<string> {
  const { id } = await startConversation(ctx);
  await askAbout(ctx, id, DANA, answer);
  return id;
}

async function partsOf(ctx: Ctx, conversationId: string) {
  return (await getConversation(ctx, conversationId)).messages.map((message) => message.parts);
}

describe("deleting a connection", () => {
  it("replaces the replies that drew on it with a tombstone, keeping the conversation in order", async () => {
    const { orgA, memberBox } = await setupMemory();
    const member = orgA.member.ctx;
    const { id } = await startConversation(member);
    fakeAiGateway.reply({ text: "Hello, ask me anything." });
    await readTurn(await streamTurn(member, id, "Hi"));
    await askAbout(member, id, DANA, "MARKER-185-A: Dana asked for a demo.");
    expect(await tablesHolding("MARKER-185-A")).toEqual(["agent_messages"]);

    await disconnect(member, memberBox.connectionId);

    const conversation = await getConversation(member, id);
    expect(conversation.messages.map((message) => [message.role, message.parts])).toEqual([
      ["user", [{ type: "text", text: "Hi" }]],
      ["assistant", [{ type: "text", text: "Hello, ask me anything." }]],
      ["user", [{ type: "text", text: `Tell me about ${DANA}` }]],
      ["assistant", REMOVED],
    ]);
    expect(conversation.citations).toEqual([]);
    expect(await tablesHolding("MARKER-185-A")).toEqual([]);
  });

  it.each(["the member's mailbox", "the company's sales inbox"] as const)(
    "takes a reply that drew on two connections when %s goes",
    async (which) => {
      const { orgA, memberBox, salesBox } = await setupMemory();
      const member = orgA.member.ctx;
      // The member sees the demo through their own mailbox, the orders through the sales inbox.
      const id = await askedAboutDana(member, "Dana wants a demo and orders every spring.");
      const kept = await startConversation(orgA.admin.ctx);
      fakeAiGateway.reply({ text: "Nothing read." });
      await readTurn(await streamTurn(orgA.admin.ctx, kept.id, "Hi"));

      if (which === "the member's mailbox") await disconnect(member, memberBox.connectionId);
      else await disconnect(orgA.admin.ctx, salesBox.connectionId);

      expect((await partsOf(member, id)).at(-1)).toEqual(REMOVED);
      // A reply that drew on nothing stays.
      expect((await partsOf(orgA.admin.ctx, kept.id)).at(-1)).toEqual([
        { type: "text", text: "Nothing read." },
      ]);
    },
  );

  it("takes the reply even when the fact it read lives on through another copy", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    await startMemory(systemCtx(orgA.id), { monthlyBudget: 1000 });
    const { admin, member } = orgA;
    const DEAL = "Dana Ruiz agreed to hold the oak price until March.";
    const email = {
      from: `Dana Ruiz <${DANA}>`,
      to: [member.email, admin.email],
      subject: "Oak price",
      text: "I'll hold the oak price until March.",
      at: daysAgo(2),
      headers: { "Message-ID": "<oak-price@acme.example>" },
    };
    await learnFrom(orgA, member.ctx, member.email, email, learned(DEAL, "hold the oak price"));
    // The admin's copy of the same email adds a source to the same fact, with no model call.
    const adminBox = await connectMailbox(admin.ctx, admin.email, [email]);
    await backfillConnection(admin.ctx, adminBox.id);
    await learnStoredItems(orgA.id);
    const id = await askedAboutDana(member.ctx, "MARKER-185-B: the oak price holds.");

    await disconnect(admin.ctx, adminBox.id);

    // The member still knows it from their own copy, but the reply drew on the admin's too.
    const left = await readObject(member.ctx, { key: { kind: "email", value: DANA } });
    expect(left.facts.map((fact) => fact.statement)).toEqual([DEAL]);
    expect((await partsOf(member.ctx, id)).at(-1)).toEqual(REMOVED);
    expect(await tablesHolding("MARKER-185-B")).toEqual([]);
  });
});

describe("deleting a fact a reply read", () => {
  it("by forgetting the person takes that reply, and leaves a reply that read only other facts", async () => {
    const { orgA } = await setupMemory();
    const member = orgA.member.ctx;
    const support = `support@${orgA.workspaceDomain}`;
    const KIM = "kim@globex.example";
    const WIDGETS = "Kim Lee buys widgets for Globex.";
    await learnFrom(
      orgA,
      orgA.admin.ctx,
      support,
      {
        from: `Kim Lee <${KIM}>`,
        to: [support],
        subject: "Widgets",
        text: "I buy widgets for Globex.",
        at: daysAgo(3),
      },
      {
        objects: [{ ref: "kim", kind: "person", name: "Kim Lee", email: KIM }],
        facts: [{ about: "kim", statement: WIDGETS, evidence: "I buy widgets for Globex" }],
      },
      "org",
    );
    const aboutDana = await askedAboutDana(member, "MARKER-185-C: Dana wants a demo.");
    const aboutKim = await startConversation(member);
    await askAbout(member, aboutKim.id, KIM, "Kim buys widgets.");

    await forgetPerson(orgA.admin.ctx, { email: DANA });

    expect((await partsOf(member, aboutDana)).at(-1)).toEqual(REMOVED);
    expect((await partsOf(member, aboutKim.id)).at(-1)).toContainEqual({
      type: "text",
      text: "Kim buys widgets.",
    });
    expect(await tablesHolding("MARKER-185-C")).toEqual([]);
  });

  it("when its email leaves Gmail takes the reply", async () => {
    const { orgA, memberBox } = await setupMemory();
    const member = orgA.member.ctx;
    const id = await askedAboutDana(member, "Dana wants a demo.");

    await deleteRemovedItem(systemCtx(orgA.id), {
      connectionId: memberBox.connectionId,
      app: "gmail",
      itemId: memberBox.sourceRef,
    });

    expect((await partsOf(member, id)).at(-1)).toEqual(REMOVED);
  });

  it("when retention removes its source takes the reply", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    await startMemory(systemCtx(orgA.id), { monthlyBudget: 1000 });
    const member = orgA.member;
    const box = await connectMailbox(member.ctx, member.email, []);
    await backfillConnection(member.ctx, box.id);
    const old = "Dana Ruiz renews every March.";
    box.mailbox.add({
      from: `Dana Ruiz <${DANA}>`,
      to: [member.email],
      text: "We renew every March.",
      at: daysAgo(400),
    });
    await pollConnection(systemCtx(orgA.id), box.id);
    scriptLearning({
      objects: [dana],
      facts: [{ about: "dana", statement: old, evidence: "We renew every March" }],
    });
    await learnStoredItems(orgA.id);
    const id = await askedAboutDana(member.ctx, "Dana renews in March.");

    await setRetentionWindow(orgA.admin.ctx, { months: 12 });
    await applyRetention(systemCtx(orgA.id));

    expect((await partsOf(member.ctx, id)).at(-1)).toEqual(REMOVED);
  });

  it("when the member whose mailbox taught it leaves takes a colleague's reply", async () => {
    const { orgA } = await setupMemory();
    const { admin } = orgA;
    const lee = await seedUser(orgA.id, `lee@${orgA.workspaceDomain}`, "member");
    // Lee writes to the admin, so the admin sees what Lee's sent copy taught.
    const DEAL = "Dana Ruiz agreed to hold the oak price until March.";
    await learnFrom(
      orgA,
      lee.ctx,
      lee.email,
      {
        from: lee.email,
        to: [admin.email],
        cc: [DANA],
        subject: "Oak price",
        text: "Dana said she'd hold the oak price until March.",
        at: daysAgo(1),
        sent: true,
      },
      learned(DEAL, "hold the oak price"),
    );
    const id = await askedAboutDana(admin.ctx, "MARKER-185-D: the oak price holds.");

    await removeUser(admin.ctx, lee.id);
    await deleteMemberConnectionsOf(admin.ctx, lee.id);

    expect((await partsOf(admin.ctx, id)).at(-1)).toEqual(REMOVED);
    expect(await tablesHolding("MARKER-185-D")).toEqual([]);
  });

  it("removes the reply that saved a told fact once the person's delete can't be undone", async () => {
    const { orgA } = await setupMemory();
    const member = orgA.member.ctx;
    const { id } = await startConversation(member);
    scriptTelling();
    fakeAiGateway.reply({
      toolCalls: [{ name: "remember", input: { email: DANA, statement: TOLD_NOTE } }],
    });
    fakeAiGateway.reply({ text: "MARKER-185-T: saved your note about Dana." });
    await readTurn(await streamTurn(member, id, `Remember that ${TOLD_NOTE}`));
    const saved = (await partsOf(member, id)).at(-1)?.find((part) => part.type === "tool")
      ?.output as { factIds: string[] };

    await deleteToldFact(member, saved.factIds[0] ?? "");
    // Within the undo window the note can come back, and so does the reply with it.
    expect(await tablesHolding("MARKER-185-T")).toEqual(["agent_messages"]);

    setNow(new Date(Date.now() + (TOLD_UNDO_MINUTES + 1) * 60_000));
    await purgeDeletedToldFacts(systemCtx(orgA.id));

    expect((await partsOf(member, id)).at(-1)).toEqual(REMOVED);
    expect(await tablesHolding("MARKER-185-T")).toEqual([]);
  });
});

describe("a removed reply", () => {
  it("shows on the page as removed, in its place", async () => {
    const { orgA, memberBox } = await setupMemory();
    const member = orgA.member.ctx;
    const id = await askedAboutDana(member, "MARKER-185-E: Dana wants a demo.");
    await disconnect(member, memberBox.connectionId);

    const page = renderToStaticMarkup(
      createElement(AskMycel, {
        rail: { query: null, conversations: await listConversations(member) },
        conversation: await getConversation(member, id),
      }),
    );

    expect(page).toContain("Removed: something this reply used was deleted.");
    expect(page).toContain(`Tell me about ${DANA}`);
    expect(page).not.toContain("MARKER-185-E");
  });

  it("isn't sent to the model with the conversation's history", async () => {
    const { orgA, memberBox } = await setupMemory();
    const member = orgA.member.ctx;
    const id = await askedAboutDana(member, "MARKER-185-F: Dana wants a demo.");
    await disconnect(member, memberBox.connectionId);
    const before = fakeAiGateway.requests("language").length;

    fakeAiGateway.reply({ text: "Ask me again." });
    await readTurn(await streamTurn(member, id, "And then?"));

    const sent = JSON.stringify(fakeAiGateway.requests("language").slice(before));
    expect(sent).toContain("And then?");
    expect(sent).not.toContain("MARKER-185-F");
  });

  it("takes later replies with it, since the model read its words", async () => {
    const { orgA, memberBox } = await setupMemory();
    const member = orgA.member.ctx;
    const id = await askedAboutDana(member, "Dana wants a demo.");
    fakeAiGateway.reply({ text: "MARKER-185-G: as I said, a demo." });
    await readTurn(await streamTurn(member, id, "Say that again?"));

    await disconnect(member, memberBox.connectionId);

    const parts = await partsOf(member, id);
    expect([parts[1], parts[3]]).toEqual([REMOVED, REMOVED]);
    expect(await tablesHolding("MARKER-185-G")).toEqual([]);
  });
});

describe("a reply that found messages", () => {
  /** Org A, funded, the member's own mailbox holding one email from Ada; a conversation. */
  async function memberWithMail() {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const member = orgA.member.ctx;
    const own = await connectMailbox(member, orgA.member.email, [
      { from: "Ada <ada@acme.example>", subject: "SUBJECT-237 oak chairs", at: daysAgo(2) },
    ]);
    const { id } = await startConversation(member);
    return { member, own, id };
  }

  /** One turn: the agent searches the person's mail from `from`, then answers `answer`. */
  async function findFrom(ctx: Ctx, conversationId: string, from: string, answer: string) {
    fakeAiGateway.reply({ toolCalls: [{ name: "find_messages", input: { from } }] });
    fakeAiGateway.reply({ text: answer });
    await readTurn(await streamTurn(ctx, conversationId, `Find mail from ${from}`));
  }

  it("goes when the mailbox it found them in goes, though it cited no fact", async () => {
    const { member, own, id } = await memberWithMail();
    await findFrom(member, id, "ada@acme.example", "MARKER-237-A: Ada wrote SUBJECT-237.");

    await disconnect(member, own.id);

    expect((await partsOf(member, id))[1]).toEqual(REMOVED);
    expect(await tablesHolding("MARKER-237-A")).toEqual([]);
  });

  it("takes later replies with it, since the model read its words", async () => {
    const { member, own, id } = await memberWithMail();
    await findFrom(member, id, "ada@acme.example", "Ada wrote SUBJECT-237.");
    fakeAiGateway.reply({ text: "MARKER-237-B: as I said, SUBJECT-237." });
    await readTurn(await streamTurn(member, id, "Say that again?"));

    await disconnect(member, own.id);

    const parts = await partsOf(member, id);
    expect([parts[1], parts[3]]).toEqual([REMOVED, REMOVED]);
    expect(await tablesHolding("MARKER-237-B")).toEqual([]);
  });

  it("stays when the search found nothing in that mailbox", async () => {
    const { member, own, id } = await memberWithMail();
    await findFrom(member, id, "nobody@else.example", "MARKER-237-C: nothing from them.");

    await disconnect(member, own.id);

    expect((await partsOf(member, id))[1]).toContainEqual({
      type: "text",
      text: "MARKER-237-C: nothing from them.",
    });
  });
});
