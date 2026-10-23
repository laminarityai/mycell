// What someone outside the company can make memory believe by emailing it (the review of M14,
// finding 1): headers an outside sender writes never widen who sees their email, and what they
// state never replaces a fact from inside the company or one everyone sees.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, seedUser } from "@/db/testing/two-org-fixture";
import { backfillConnection } from "@/features/discovery/server";
import { systemCtx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { connectMailbox, daysAgo } from "@/testing/connect-helpers";
import { markCompanyWideList, readObject } from "../server";
import { learnStoredItems, scriptLearning, withCredits } from "./memory-helpers";

beforeEach(resetDatabase);

const MALLORY = "mallory@evil.example";
const BILLING = "Acme's billing contact is billing@acme.example.";
const EVIL = "Acme's billing contact is now pay@evil.example.";
const byAcme = { key: { kind: "domain" as const, value: "acme.example" } };
const acme = { ref: "acme", kind: "company" as const, name: "Acme", domain: "acme.example" };

const scriptBilling = () => {
  scriptLearning({
    objects: [acme],
    facts: [
      {
        about: "acme",
        statement: BILLING,
        evidence: "Acme's billing contact is billing@acme.example",
        predicate: "billing_contact",
        value: "billing@acme.example",
      },
    ],
  });
};

const scriptEvil = () => {
  scriptLearning({
    objects: [acme],
    facts: [
      {
        about: "acme",
        statement: EVIL,
        evidence: "Acme's billing contact is now pay@evil.example (acme.example)",
        predicate: "billing_contact",
        value: "pay@evil.example",
      },
    ],
  });
};

const malloryEmail = (to: string[], cc: string[] = []) => ({
  from: `Mallory <${MALLORY}>`,
  to,
  cc,
  subject: "Billing change",
  text: "Hello. Acme's billing contact is now pay@evil.example (acme.example).",
  at: daysAgo(1),
});

// Org A marks all@ company-wide, and its member tells all@ who Acme's billing contact is.
async function setup() {
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  await withCredits(orgA.id);
  const lee = await seedUser(orgA.id, `lee@${orgA.workspaceDomain}`, "member");
  const all = `all@${orgA.workspaceDomain}`;
  await markCompanyWideList(orgA.admin.ctx, all);
  const billingEmail = {
    from: orgA.member.email,
    to: [all],
    subject: "Acme billing",
    text: "FYI: Acme's billing contact is billing@acme.example.",
    at: daysAgo(5),
    sent: true,
  };
  return { ...orgs, lee, all, billingEmail };
}

const current = async (ctx: Parameters<typeof readObject>[0]) =>
  (await readObject(ctx, byAcme)).facts.map((fact) => fact.statement);

describe("an email from outside the company", () => {
  it("can't make itself company-wide by naming a company-wide list, or replace a company-wide fact", async () => {
    const { orgA, lee, all, billingEmail } = await setup();
    // Mallory writes to the member alone, and puts all@ on Cc herself.
    const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [
      billingEmail,
      malloryEmail([orgA.member.email], [all]),
    ]);
    await backfillConnection(orgA.member.ctx, mailbox.id);
    // Backfills read newest first.
    scriptEvil();
    scriptBilling();
    await learnStoredItems(orgA.id);

    // Everyone else sees only the true fact: the email never went to all@ as far as Mycel saw.
    for (const ctx of [orgA.admin.ctx, lee.ctx, systemCtx(orgA.id)]) {
      expect(await current(ctx)).toEqual([BILLING]);
    }
    // The member, whose mailbox holds both, sees both as current, Mallory's marked as
    // contradicting the company-wide fact rather than replacing it.
    const seen = await readObject(orgA.member.ctx, byAcme);
    const billing = seen.facts.find((fact) => fact.statement === BILLING);
    expect(seen.facts.map((fact) => [fact.statement, fact.conflictsWith])).toEqual(
      expect.arrayContaining([
        [BILLING, null],
        [EVIL, billing?.id],
      ]),
    );
    expect(seen.facts).toHaveLength(2);
    expect(seen.history).toEqual([]);
  });

  it("is seen by a colleague it names only once their own mailbox holds it", async () => {
    const { orgA, lee } = await setup();
    const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [
      malloryEmail([orgA.member.email], [lee.email]),
    ]);
    await backfillConnection(orgA.member.ctx, mailbox.id);
    scriptEvil();
    await learnStoredItems(orgA.id);

    expect(await current(orgA.member.ctx)).toEqual([EVIL]);
    for (const ctx of [lee.ctx, orgA.admin.ctx, systemCtx(orgA.id)]) {
      await expect(readObject(ctx, byAcme)).rejects.toThrow(NotFoundError);
    }
  });

  it("to an org inbox is company-wide, but doesn't replace a fact from inside the company", async () => {
    const { orgA, lee, billingEmail } = await setup();
    const memberBox = await connectMailbox(orgA.member.ctx, orgA.member.email, [billingEmail]);
    await backfillConnection(orgA.member.ctx, memberBox.id);
    scriptBilling();
    await learnStoredItems(orgA.id);
    const support = `support@${orgA.workspaceDomain}`;
    const inbox = await connectMailbox(orgA.admin.ctx, support, [malloryEmail([support])], "org");
    await backfillConnection(orgA.admin.ctx, inbox.id);
    scriptEvil();
    await learnStoredItems(orgA.id);

    for (const ctx of [orgA.admin.ctx, orgA.member.ctx, lee.ctx, systemCtx(orgA.id)]) {
      const seen = await readObject(ctx, byAcme);
      const billing = seen.facts.find((fact) => fact.statement === BILLING);
      expect(seen.facts.map((fact) => [fact.statement, fact.conflictsWith])).toEqual([
        [BILLING, null],
        [EVIL, billing?.id],
      ]);
      expect(seen.history).toEqual([]);
    }
  });

  it("still replaces what the same mailbox learned from outside before", async () => {
    const { orgA } = await setup();
    const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [
      {
        from: "Dana Ruiz <dana@acme.example>",
        to: [orgA.member.email],
        text: "Acme's billing contact is billing@acme.example.",
        at: daysAgo(5),
      },
      malloryEmail([orgA.member.email]),
    ]);
    await backfillConnection(orgA.member.ctx, mailbox.id);
    scriptEvil();
    scriptBilling();
    await learnStoredItems(orgA.id);

    const seen = await readObject(orgA.member.ctx, byAcme);
    expect(seen.facts.map((fact) => [fact.statement, fact.conflictsWith])).toEqual([[EVIL, null]]);
    expect(seen.history.map((fact) => fact.statement)).toEqual([BILLING]);
  });
});

describe("an email sent from inside the company", () => {
  it("is seen by everyone it was sent to, and replaces what an older one said", async () => {
    const { orgA, lee, all, billingEmail } = await setup();
    const newer = "Acme's billing contact is now ap@acme.example.";
    const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [
      billingEmail,
      {
        from: orgA.member.email,
        to: [lee.email],
        text: "Acme's billing contact is now ap@acme.example.",
        at: daysAgo(1),
        sent: true,
      },
    ]);
    await backfillConnection(orgA.member.ctx, mailbox.id);
    scriptLearning({
      objects: [acme],
      facts: [
        {
          about: "acme",
          statement: newer,
          evidence: "Acme's billing contact is now ap@acme.example",
          predicate: "billing_contact",
          value: "ap@acme.example",
        },
      ],
    });
    scriptBilling();
    await learnStoredItems(orgA.id);

    // Sent to all@ by the member: everyone. Sent to Lee: the member and Lee.
    for (const ctx of [orgA.admin.ctx, systemCtx(orgA.id)]) {
      expect(await current(ctx)).toEqual([BILLING]);
    }
    for (const ctx of [orgA.member.ctx, lee.ctx]) {
      const seen = await readObject(ctx, byAcme);
      expect(seen.facts.map((fact) => [fact.statement, fact.conflictsWith])).toEqual([
        [newer, null],
      ]);
      expect(seen.history.map((fact) => fact.statement)).toEqual([BILLING]);
    }
    expect(all).toBe(`all@${orgA.workspaceDomain}`);
  });
});
