import { beforeEach, describe, expect, it } from "vitest";
import { tablesHolding } from "@/db/testing/content-scan";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, seedUser } from "@/db/testing/two-org-fixture";
import { disconnect } from "@/features/connections/server";
import { listLedger } from "@/features/credits/server";
import { backfillConnection, pollConnection } from "@/features/discovery/server";
import { systemCtx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { connectMailbox, daysAgo } from "@/testing/connect-helpers";
import type { FakeMessageInput } from "@/testing/fake-gmail";
import { learnFromItem, readObject } from "../server";
import {
  classifiedAs,
  learnStoredItems,
  scriptLearning,
  withCredits,
  type ScriptedExtraction,
} from "./memory-helpers";

beforeEach(resetDatabase);

const DANA = "dana@acme.example";
const MARKER = "ZEBRA-MARKER-7731";
const ROLE = "Dana Ruiz leads procurement at Acme.";
const RENEWAL = "Acme's renewal is due in March.";

// Dana at Acme writes to org A's member, copying its admin.
async function setup() {
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  await withCredits(orgA.id);
  const lee = await seedUser(orgA.id, `lee@${orgA.workspaceDomain}`, "member");
  const danaEmail = (overrides: Partial<FakeMessageInput> = {}): FakeMessageInput => ({
    from: `Dana Ruiz <${DANA}>`,
    to: [orgA.member.email],
    cc: [orgA.admin.email],
    subject: "Renewal",
    text: `Hi, I lead procurement at Acme. Our renewal is due in March (ref ${MARKER}).`,
    at: daysAgo(2),
    ...overrides,
  });
  return { ...orgs, lee, danaEmail };
}

const DANA_AND_ACME: ScriptedExtraction = {
  objects: [
    { ref: "dana", kind: "person", name: "Dana Ruiz", email: DANA },
    { ref: "acme", kind: "company", name: "Acme", domain: "acme.example" },
  ],
  facts: [
    {
      about: "dana",
      statement: ROLE,
      evidence: "I lead procurement at Acme",
      predicate: "role",
      value: "procurement lead",
      object: "acme",
    },
    { about: "acme", statement: RENEWAL, evidence: `Our renewal is due in March (ref ${MARKER})` },
  ],
};

const byEmail = (value: string) => ({ key: { kind: "email" as const, value } });
const byDomain = (value: string) => ({ key: { kind: "domain" as const, value } });

describe("learning from a Gmail message", () => {
  it("creates objects and facts linked to a business email", async () => {
    const { orgA, danaEmail } = await setup();
    const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [danaEmail()]);
    await backfillConnection(orgA.member.ctx, mailbox.id);
    scriptLearning(DANA_AND_ACME);

    expect(await learnStoredItems(orgA.id)).toEqual([{ outcome: "learned", objects: 2, facts: 2 }]);

    const message = (mailbox.mailbox.list(new URLSearchParams()).messages ?? []).at(0);
    const dana = await readObject(orgA.member.ctx, byEmail(DANA));
    expect(dana).toMatchObject({
      kind: "person",
      name: "Dana Ruiz",
      keys: [{ kind: "email", value: DANA }],
      facts: [
        {
          statement: ROLE,
          predicate: "role",
          value: "procurement lead",
          linkedObject: { kind: "company", name: "Acme" },
          sources: [{ app: "gmail", connectionId: mailbox.id, sourceRef: message?.id }],
        },
      ],
    });
    const acme = await readObject(orgA.member.ctx, byDomain("acme.example"));
    expect(acme.facts.map((fact) => fact.statement)).toEqual([RENEWAL]);
    expect(dana.facts[0]?.linkedObject?.id).toBe(acme.id);
    expect((await readObject(orgA.member.ctx, { id: dana.id })).id).toBe(dana.id);
  });

  it("creates nothing from a newsletter", async () => {
    const { orgA } = await setup();
    const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [
      {
        from: "news@deals.example",
        to: [orgA.member.email],
        text: "This week's offers",
        at: daysAgo(1),
      },
    ]);
    await backfillConnection(orgA.member.ctx, mailbox.id);
    classifiedAs("newsletter");

    expect(await learnStoredItems(orgA.id)).toEqual([
      { outcome: "skipped", reason: "not_business" },
    ]);
    await expect(readObject(orgA.member.ctx, byEmail("news@deals.example"))).rejects.toThrow(
      NotFoundError,
    );
  });

  it("keeps only what the email states, and only work facts about people outside the company", async () => {
    const { orgA, danaEmail } = await setup();
    const text = "I lead procurement at Acme. I'm off to Spain with my kids next week.";
    const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [danaEmail({ text })]);
    await backfillConnection(orgA.member.ctx, mailbox.id);
    scriptLearning(
      {
        objects: [
          { ref: "dana", kind: "person", name: "Dana Ruiz", email: DANA },
          // An address the email never mentions.
          { ref: "kim", kind: "person", name: "Kim", email: "kim@acme.example" },
        ],
        facts: [
          { about: "dana", statement: ROLE, evidence: "I lead procurement at Acme" },
          // Personal, about someone outside the company.
          {
            about: "dana",
            statement: "Dana is going to Spain with her kids.",
            evidence: "I'm off to Spain with my kids next week",
            personal: true,
          },
          // Not something the email says.
          { about: "dana", statement: "Dana is unhappy with us.", evidence: "We're unhappy" },
          { about: "kim", statement: "Kim works at Acme.", evidence: "I lead procurement" },
        ],
      },
      1,
    );

    expect(await learnStoredItems(orgA.id)).toEqual([{ outcome: "learned", objects: 1, facts: 1 }]);
    const dana = await readObject(orgA.member.ctx, byEmail(DANA));
    expect(dana.facts.map((fact) => fact.statement)).toEqual([ROLE]);
    await expect(readObject(orgA.member.ctx, byEmail("kim@acme.example"))).rejects.toThrow(
      NotFoundError,
    );
  });

  it("drops a fact that copies a long run of the email word for word", async () => {
    const { orgA, danaEmail } = await setup();
    const text =
      "I lead procurement at Acme. " +
      `Please wire the deposit to account ${MARKER} at the usual bank before Friday.`;
    const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [danaEmail({ text })]);
    await backfillConnection(orgA.member.ctx, mailbox.id);
    scriptLearning(
      {
        objects: [{ ref: "dana", kind: "person", name: "Dana Ruiz", email: DANA }],
        facts: [
          { about: "dana", statement: ROLE, evidence: "I lead procurement at Acme" },
          // The source's own sentence, with a few words changed around it.
          {
            about: "dana",
            statement: `Dana asks us to wire the deposit to account ${MARKER} at the usual bank.`,
            evidence: `Please wire the deposit to account ${MARKER} at the usual bank before Friday`,
          },
        ],
      },
      1,
    );

    expect(await learnStoredItems(orgA.id)).toEqual([{ outcome: "learned", objects: 1, facts: 1 }]);
    const dana = await readObject(orgA.member.ctx, byEmail(DANA));
    expect(dana.facts.map((fact) => fact.statement)).toEqual([ROLE]);
    expect(await tablesHolding(MARKER)).toEqual([]);
  });

  it("attaches facts about the same address from two emails to one object", async () => {
    const { orgA, danaEmail } = await setup();
    const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [danaEmail()]);
    await backfillConnection(orgA.member.ctx, mailbox.id);
    scriptLearning(DANA_AND_ACME);
    await learnStoredItems(orgA.id);
    mailbox.mailbox.add(danaEmail({ text: "Please send the invoice to me.", at: new Date() }));
    await pollConnection(systemCtx(orgA.id), mailbox.id);
    scriptLearning({
      objects: [{ ref: "d", kind: "person", name: "Dana", email: DANA.toUpperCase() }],
      facts: [
        {
          about: "d",
          statement: "Dana asked for the invoice to be sent to her.",
          evidence: "send the invoice to me",
        },
      ],
    });

    await learnStoredItems(orgA.id);

    const dana = await readObject(orgA.member.ctx, byEmail(DANA));
    expect(dana.name).toBe("Dana Ruiz");
    expect(dana.facts.map((fact) => fact.statement)).toEqual([
      ROLE,
      "Dana asked for the invoice to be sent to her.",
    ]);
  });

  it("skips an item it already learned, with no model call", async () => {
    const { orgA, danaEmail } = await setup();
    const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [danaEmail()]);
    await backfillConnection(orgA.member.ctx, mailbox.id);
    scriptLearning(DANA_AND_ACME);
    await learnStoredItems(orgA.id);
    const message = (mailbox.mailbox.list(new URLSearchParams()).messages ?? []).at(0);

    expect(
      await learnFromItem(systemCtx(orgA.id), {
        connectionId: mailbox.id,
        app: "gmail",
        sourceRef: message?.id ?? "",
      }),
    ).toEqual({ outcome: "skipped", reason: "known" });
  });

  it("records every model call in the ledger", async () => {
    const { orgA, danaEmail } = await setup();
    const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [danaEmail()]);
    await backfillConnection(orgA.member.ctx, mailbox.id);
    scriptLearning(DANA_AND_ACME);

    await learnStoredItems(orgA.id);

    const usage = (await listLedger(systemCtx(orgA.id))).filter((e) => e.kind === "usage");
    expect(usage.map((entry) => [entry.role ?? entry.modelId, entry.outcome]).sort()).toEqual([
      ["classify", "succeeded"],
      ["embed", "succeeded"],
      ["fast", "succeeded"],
      // The injection screen, which names no role.
      ["google/model-armor", "succeeded"],
    ]);
  });

  it("stores no source text", async () => {
    const { orgA, danaEmail } = await setup();
    const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [danaEmail()]);
    await backfillConnection(orgA.member.ctx, mailbox.id);
    scriptLearning(DANA_AND_ACME);

    await learnStoredItems(orgA.id);

    expect(await readObject(orgA.member.ctx, byEmail(DANA))).toBeDefined();
    expect(await tablesHolding(MARKER)).toEqual([]);
  });

  it("ends quietly when the connection is gone", async () => {
    const { orgA, danaEmail } = await setup();
    const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [danaEmail()]);
    await backfillConnection(orgA.member.ctx, mailbox.id);
    await disconnect(orgA.member.ctx, mailbox.id);

    expect(await learnStoredItems(orgA.id)).toEqual([{ outcome: "gone" }]);
  });
});

describe("reading an object", () => {
  it("shows an email's facts to the mailboxes holding it, not to whoever its sender named", async () => {
    const { orgA, lee, danaEmail } = await setup();
    const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [danaEmail()]);
    await backfillConnection(orgA.member.ctx, mailbox.id);
    scriptLearning(DANA_AND_ACME);
    await learnStoredItems(orgA.id);

    const dana = await readObject(orgA.member.ctx, byEmail(DANA));
    // Dana copied the admin, but only the member's mailbox is known to hold it.
    await expect(readObject(orgA.admin.ctx, byEmail(DANA))).rejects.toThrow(NotFoundError);
    await expect(readObject(lee.ctx, byEmail(DANA))).rejects.toThrow(NotFoundError);
    await expect(readObject(lee.ctx, { id: dana.id })).rejects.toThrow(NotFoundError);
    await expect(readObject(systemCtx(orgA.id), { id: dana.id })).rejects.toThrow(NotFoundError);
  });

  it("shows the facts from the caller's own mailbox, even when they aren't on the email", async () => {
    const { orgA, danaEmail } = await setup();
    // Bcc'd to someone else: the member's own copy is all that ties them to it.
    const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [
      danaEmail({ to: ["procurement@acme.example"], cc: [] }),
    ]);
    await backfillConnection(orgA.member.ctx, mailbox.id);
    scriptLearning(DANA_AND_ACME);
    await learnStoredItems(orgA.id);

    expect((await readObject(orgA.member.ctx, byEmail(DANA))).facts).toHaveLength(1);
    await expect(readObject(orgA.admin.ctx, byEmail(DANA))).rejects.toThrow(NotFoundError);
  });
});

describe("disconnecting", () => {
  it("removes the source records, and the facts left without a source", async () => {
    const { orgA, danaEmail } = await setup();
    const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [danaEmail()]);
    await backfillConnection(orgA.member.ctx, mailbox.id);
    scriptLearning(DANA_AND_ACME);
    await learnStoredItems(orgA.id);

    await disconnect(orgA.member.ctx, mailbox.id);

    await expect(readObject(orgA.admin.ctx, byEmail(DANA))).rejects.toThrow(NotFoundError);
    expect(await tablesHolding(ROLE)).toEqual([]);
    expect(await tablesHolding(RENEWAL)).toEqual([]);
    expect(await tablesHolding("Dana Ruiz")).toEqual([]);
  });

  it("keeps a fact another copy of the email still supports", async () => {
    const { orgA, danaEmail } = await setup();
    const shared = danaEmail({ headers: { "Message-ID": "<renewal-1@acme.example>" } });
    const memberBox = await connectMailbox(orgA.member.ctx, orgA.member.email, [shared]);
    const adminBox = await connectMailbox(orgA.admin.ctx, orgA.admin.email, [shared]);
    await backfillConnection(orgA.member.ctx, memberBox.id);
    await backfillConnection(orgA.admin.ctx, adminBox.id);
    // One extraction: the second copy reuses the first's facts, with no model call.
    scriptLearning(DANA_AND_ACME);

    expect(await learnStoredItems(orgA.id)).toEqual([
      { outcome: "learned", objects: 2, facts: 2 },
      { outcome: "learned", objects: 2, facts: 2 },
    ]);
    const before = await readObject(orgA.admin.ctx, byEmail(DANA));
    expect(before.facts[0]?.sources.map((source) => source.connectionId).sort()).toEqual(
      [memberBox.id, adminBox.id].sort(),
    );

    await disconnect(orgA.member.ctx, memberBox.id);

    const after = await readObject(orgA.admin.ctx, byEmail(DANA));
    expect(after.id).toBe(before.id);
    expect(after.facts.map((fact) => fact.statement)).toEqual([ROLE]);
    expect(after.facts[0]?.sources.map((source) => source.connectionId)).toEqual([adminBox.id]);
  });
});
