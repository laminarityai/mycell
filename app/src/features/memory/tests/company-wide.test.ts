import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, seedUser } from "@/db/testing/two-org-fixture";
import { backfillConnection, pollConnection } from "@/features/discovery/server";
import { systemCtx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { connectMailbox, daysAgo } from "@/testing/connect-helpers";
import type { FakeMessageInput } from "@/testing/fake-gmail";
import {
  listCompanyWideLists,
  markCompanyWideList,
  readObject,
  searchMemory,
  unmarkCompanyWideList,
} from "../server";
import {
  learnStoredItems,
  scriptLearning,
  withCredits,
  type ScriptedExtraction,
} from "./memory-helpers";

beforeEach(resetDatabase);

const DANA = "dana@acme.example";
const ROLE = "Dana Ruiz leads procurement at Acme.";
const MOVING = "Dana Ruiz is moving to Acme's Leeds office.";
const DEMO = "Dana Ruiz asked for a demo.";
const BUDGET = "Dana Ruiz approved the budget.";

const DANA_ROLE: ScriptedExtraction = {
  objects: [{ ref: "dana", kind: "person", name: "Dana Ruiz", email: DANA }],
  facts: [{ about: "dana", statement: ROLE, evidence: "I lead procurement at Acme" }],
};

const byDana = { key: { kind: "email" as const, value: DANA } };

// Org A with a third person, Lee, who is on none of Dana's emails.
async function setup() {
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  await withCredits(orgA.id);
  const lee = await seedUser(orgA.id, `lee@${orgA.workspaceDomain}`, "member");
  const danaEmail = (
    to: string[],
    overrides: Partial<FakeMessageInput> = {},
  ): FakeMessageInput => ({
    from: `Dana Ruiz <${DANA}>`,
    to,
    subject: "Procurement",
    text: "Hi, I lead procurement at Acme.",
    at: daysAgo(2),
    ...overrides,
  });
  return { ...orgs, lee, danaEmail };
}

// The email as a colleague sent it, copying Dana: its copy in their own mailbox is a sent one.
const sentBy = (from: string, email: FakeMessageInput): FakeMessageInput => ({
  ...email,
  from,
  cc: [DANA],
  sent: true,
});

const statements = async (ctx: Parameters<typeof readObject>[0]) =>
  (await readObject(ctx, byDana)).facts.map((fact) => fact.statement);

describe("an org connection", () => {
  it("makes its facts visible to every member, and to the org's workflows", async () => {
    const { orgA, lee, danaEmail } = await setup();
    const support = `support@${orgA.workspaceDomain}`;
    const inbox = await connectMailbox(orgA.admin.ctx, support, [danaEmail([support])], "org");
    await backfillConnection(orgA.admin.ctx, inbox.id);
    scriptLearning(DANA_ROLE);
    await learnStoredItems(orgA.id);

    for (const ctx of [orgA.admin.ctx, orgA.member.ctx, lee.ctx, systemCtx(orgA.id)]) {
      const dana = await readObject(ctx, byDana);
      expect(dana.facts.map((fact) => fact.statement)).toEqual([ROLE]);
      expect(dana.facts[0]?.sources.map((source) => source.connectionId)).toEqual([inbox.id]);
    }
  });
});

describe("a group that isn't marked company-wide", () => {
  it("counts only for members whose own mailbox holds the email", async () => {
    const { orgA, lee, danaEmail } = await setup();
    const sales = `sales@${orgA.workspaceDomain}`;
    const email = danaEmail([sales], { headers: { "Message-ID": "<intro-1@acme.example>" } });
    const memberBox = await connectMailbox(orgA.member.ctx, orgA.member.email, [email]);
    const leeBox = await connectMailbox(lee.ctx, lee.email, [email]);
    await backfillConnection(orgA.member.ctx, memberBox.id);
    await backfillConnection(lee.ctx, leeBox.id);
    scriptLearning(DANA_ROLE);
    await learnStoredItems(orgA.id);

    for (const ctx of [orgA.member.ctx, lee.ctx]) {
      const dana = await readObject(ctx, byDana);
      expect(dana.facts.map((fact) => fact.statement)).toEqual([ROLE]);
      expect(dana.facts[0]?.sources.map((source) => source.connectionId).sort()).toEqual(
        [memberBox.id, leeBox.id].sort(),
      );
    }
    // The admin may well be in sales@, but Mycel never guesses who is.
    for (const ctx of [orgA.admin.ctx, systemCtx(orgA.id)]) {
      await expect(readObject(ctx, byDana)).rejects.toThrow(NotFoundError);
    }
  });
});

describe("a list an admin marked company-wide", () => {
  it("makes email a colleague sent to it visible to every member, until it's unmarked", async () => {
    const { orgA, lee, danaEmail } = await setup();
    const all = `all@${orgA.workspaceDomain}`;
    await markCompanyWideList(orgA.admin.ctx, ` ${all.toUpperCase()} `);
    expect(await listCompanyWideLists(orgA.admin.ctx)).toEqual([
      { address: all, markedAt: expect.any(Date) as Date },
    ]);
    const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [
      sentBy(orgA.member.email, danaEmail([all])),
    ]);
    await backfillConnection(orgA.member.ctx, mailbox.id);
    scriptLearning(DANA_ROLE);
    await learnStoredItems(orgA.id);

    for (const ctx of [orgA.admin.ctx, orgA.member.ctx, lee.ctx, systemCtx(orgA.id)]) {
      expect(await statements(ctx)).toEqual([ROLE]);
    }

    await unmarkCompanyWideList(orgA.admin.ctx, all);

    expect(await listCompanyWideLists(orgA.admin.ctx)).toEqual([]);
    expect(await statements(orgA.member.ctx)).toEqual([ROLE]);
    for (const ctx of [orgA.admin.ctx, lee.ctx, systemCtx(orgA.id)]) {
      await expect(readObject(ctx, byDana)).rejects.toThrow(NotFoundError);
    }
  });

  it("is marked only by an admin, and only for a group at the company's domain", async () => {
    const { orgA, lee } = await setup();
    const all = `all@${orgA.workspaceDomain}`;

    for (const ctx of [orgA.member.ctx, systemCtx(orgA.id)]) {
      await expect(markCompanyWideList(ctx, all)).rejects.toThrow(ForbiddenError);
      await expect(unmarkCompanyWideList(ctx, all)).rejects.toThrow(ForbiddenError);
      await expect(listCompanyWideLists(ctx)).rejects.toThrow(ForbiddenError);
    }
    // A person's own address isn't a list: marking it would show everyone their mail.
    for (const address of [lee.email, orgA.admin.email, "not an address", "all@acme.example"]) {
      await expect(markCompanyWideList(orgA.admin.ctx, address)).rejects.toThrow(ValidationError);
    }
    expect(await listCompanyWideLists(orgA.admin.ctx)).toEqual([]);

    await markCompanyWideList(orgA.admin.ctx, all);
    await markCompanyWideList(orgA.admin.ctx, all);
    const lists = await listCompanyWideLists(orgA.admin.ctx);
    expect(lists.map((list) => list.address)).toEqual([all]);
  });

  it("doesn't let an email from outside count as sent to it", async () => {
    const { orgA, lee, danaEmail } = await setup();
    const all = `all@${orgA.workspaceDomain}`;
    await markCompanyWideList(orgA.admin.ctx, all);
    // Dana wrote all@ on it; only the member's mailbox is known to hold it.
    const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [danaEmail([all])]);
    await backfillConnection(orgA.member.ctx, mailbox.id);
    scriptLearning(DANA_ROLE);
    await learnStoredItems(orgA.id);

    expect(await statements(orgA.member.ctx)).toEqual([ROLE]);
    for (const ctx of [orgA.admin.ctx, lee.ctx, systemCtx(orgA.id)]) {
      await expect(readObject(ctx, byDana)).rejects.toThrow(NotFoundError);
    }
  });

  it("stops counting as a list once it's a person's own address", async () => {
    const { orgA, lee, danaEmail } = await setup();
    const kim = `kim@${orgA.workspaceDomain}`;
    await markCompanyWideList(orgA.admin.ctx, kim);
    const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [
      sentBy(orgA.member.email, danaEmail([kim])),
    ]);
    await backfillConnection(orgA.member.ctx, mailbox.id);
    scriptLearning(DANA_ROLE);
    await learnStoredItems(orgA.id);
    expect(await statements(lee.ctx)).toEqual([ROLE]);

    // Kim joins: email to her is hers, whatever was marked before.
    const joined = await seedUser(orgA.id, kim, "member");

    expect(await statements(joined.ctx)).toEqual([ROLE]);
    for (const ctx of [orgA.admin.ctx, lee.ctx, systemCtx(orgA.id)]) {
      await expect(readObject(ctx, byDana)).rejects.toThrow(NotFoundError);
    }
  });

  it("never applies in another company", async () => {
    const { orgA, orgB, lee, danaEmail } = await setup();
    // Org B's all-staff list, copied on an email to org A's member.
    const allB = `all@${orgB.workspaceDomain}`;
    await markCompanyWideList(orgB.admin.ctx, allB);
    const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [
      danaEmail([orgA.member.email], { cc: [allB] }),
    ]);
    await backfillConnection(orgA.member.ctx, mailbox.id);
    scriptLearning(DANA_ROLE);
    await learnStoredItems(orgA.id);

    expect(await statements(orgA.member.ctx)).toEqual([ROLE]);
    for (const ctx of [orgA.admin.ctx, lee.ctx, systemCtx(orgA.id)]) {
      await expect(readObject(ctx, byDana)).rejects.toThrow(NotFoundError);
    }
  });
});

describe("searching memory", () => {
  it("finds company-wide facts for everyone, and the rest only for whoever can see them", async () => {
    const { orgA, lee, danaEmail } = await setup();
    const support = `support@${orgA.workspaceDomain}`;
    const all = `all@${orgA.workspaceDomain}`;
    const sales = `sales@${orgA.workspaceDomain}`;
    await markCompanyWideList(orgA.admin.ctx, all);
    const learn = async (statement: string, evidence: string) => {
      scriptLearning({
        objects: DANA_ROLE.objects,
        facts: [{ about: "dana", statement, evidence }],
      });
      await learnStoredItems(orgA.id);
    };
    const said = (text: string, to: string[], headers?: Record<string, string>) =>
      danaEmail(to, { text, at: new Date(), ...(headers === undefined ? {} : { headers }) });
    // From the shared inbox.
    const inbox = await connectMailbox(
      orgA.admin.ctx,
      support,
      [said("I lead procurement at Acme.", [support])],
      "org",
    );
    await backfillConnection(orgA.admin.ctx, inbox.id);
    await learn(ROLE, "I lead procurement at Acme");
    // To all@, which is marked, from the member.
    const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [
      sentBy(orgA.member.email, said("I'm moving to the Leeds office.", [all])),
    ]);
    await backfillConnection(orgA.member.ctx, mailbox.id);
    await learn(MOVING, "I'm moving to the Leeds office");
    // To sales@, which isn't: the member's and Lee's mailboxes both hold it.
    const demo = said("Could we see a demo?", [sales], { "Message-ID": "<demo-1@acme.example>" });
    mailbox.mailbox.add(demo);
    await pollConnection(systemCtx(orgA.id), mailbox.id);
    await learn(DEMO, "Could we see a demo?");
    // To the member alone.
    mailbox.mailbox.add(said("The budget is approved.", [orgA.member.email]));
    await pollConnection(systemCtx(orgA.id), mailbox.id);
    await learn(BUDGET, "The budget is approved");
    const leeBox = await connectMailbox(lee.ctx, lee.email, [demo]);
    await backfillConnection(lee.ctx, leeBox.id);
    await learnStoredItems(orgA.id);

    const found = async (ctx: Parameters<typeof searchMemory>[0]) =>
      (await searchMemory(ctx, byDana)).facts.map((fact) => fact.statement).sort();
    expect(await found(orgA.member.ctx)).toEqual([BUDGET, DEMO, ROLE, MOVING].sort());
    expect(await found(lee.ctx)).toEqual([DEMO, ROLE, MOVING].sort());
    // The admin may be in sales@, but isn't on any of these but the company-wide ones.
    expect(await found(orgA.admin.ctx)).toEqual([ROLE, MOVING].sort());
    expect(await found(systemCtx(orgA.id))).toEqual([ROLE, MOVING].sort());
    expect(
      (await searchMemory(lee.ctx, { text: "budget approved" })).facts.map((f) => f.statement),
    ).toEqual([]);
  });
});

describe("a fact with several sources", () => {
  it("is visible to everyone when one source is private and another company-wide", async () => {
    const { orgA, lee, danaEmail } = await setup();
    const support = `support@${orgA.workspaceDomain}`;
    const memberBox = await connectMailbox(orgA.member.ctx, orgA.member.email, [
      danaEmail([orgA.member.email]),
    ]);
    await backfillConnection(orgA.member.ctx, memberBox.id);
    scriptLearning(DANA_ROLE);
    await learnStoredItems(orgA.id);
    const inbox = await connectMailbox(orgA.admin.ctx, support, [danaEmail([support])], "org");
    await backfillConnection(orgA.admin.ctx, inbox.id);
    scriptLearning(DANA_ROLE);
    await learnStoredItems(orgA.id);

    const own = await readObject(orgA.member.ctx, byDana);
    expect(own.facts).toHaveLength(1);
    expect(own.facts[0]?.sources.map((source) => source.connectionId).sort()).toEqual(
      [memberBox.id, inbox.id].sort(),
    );
    // Everyone else sees the same fact through the shared inbox alone.
    for (const ctx of [orgA.admin.ctx, lee.ctx, systemCtx(orgA.id)]) {
      const dana = await readObject(ctx, byDana);
      expect(dana.facts.map((fact) => fact.id)).toEqual([own.facts[0]?.id]);
      expect(dana.facts[0]?.sources.map((source) => source.connectionId)).toEqual([inbox.id]);
    }
  });
});
