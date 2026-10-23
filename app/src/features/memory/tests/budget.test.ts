import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits, listLedger } from "@/features/credits/server";
import { backfillConnection, pollConnection } from "@/features/discovery/server";
import { systemCtx } from "@/lib/ctx";
import { ConflictError, ForbiddenError } from "@/lib/errors";
import { connectGoogle, connectMailbox, daysAgo } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { fakeInngest } from "@/testing/fake-inngest";
import {
  addExclusion,
  getMemorySettings,
  queueStoredItems,
  readObject,
  removeExclusion,
  resumePostponed,
  setMemoryBudget,
  startMemory,
  summarizeObject,
} from "../server";
import { classifiedAs, grantOnly, learnStoredItems, scriptLearning } from "./memory-helpers";

beforeEach(resetDatabase);
afterEach(() => {
  vi.useRealTimers();
});

const DANA = "dana@acme.example";
const GOOGLE_DOC = "application/vnd.google-apps.document";
const ROLE = "Dana Ruiz leads procurement at Acme.";
const runInline = <T>(_id: string, run: () => Promise<T>) => run();

async function setup() {
  const orgs = await seedTwoOrgs();
  await grantOnly(orgs.orgA.id);
  return orgs;
}

describe("starting memory", () => {
  it("learns nothing until an admin confirms the estimate, then learns what was stored", async () => {
    const { orgA } = await setup();
    const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [
      {
        from: `Dana Ruiz <${DANA}>`,
        to: [orgA.member.email],
        text: "Hi, I lead procurement at Acme.",
        at: daysAgo(3),
      },
    ]);
    await backfillConnection(orgA.member.ctx, mailbox.id);

    // Nothing is scripted for the gateway: any model call would fail the test.
    expect(await learnStoredItems(orgA.id)).toEqual([
      { outcome: "skipped", reason: "not_started" },
    ]);
    expect(fakeAiGateway.requests()).toEqual([]);
    const { started, estimate } = await getMemorySettings(orgA.admin.ctx);
    expect(started).toBeNull();
    expect(estimate.items).toBe(1);
    expect(estimate.creditsPerItem).toBeGreaterThan(0);
    expect(estimate.credits).toBe(estimate.creditsPerItem);

    await startMemory(orgA.admin.ctx, { monthlyBudget: 500 });
    expect(fakeInngest.sent("memory/started").map((event) => event.data)).toEqual([
      { orgId: orgA.id },
    ]);
    expect(await queueStoredItems(systemCtx(orgA.id), runInline)).toEqual({ queued: 1 });
    scriptLearning({
      objects: [{ ref: "dana", kind: "person", name: "Dana Ruiz", email: DANA }],
      facts: [{ about: "dana", statement: ROLE, evidence: "I lead procurement at Acme" }],
    });

    expect(await learnStoredItems(orgA.id)).toEqual([{ outcome: "learned", objects: 1, facts: 1 }]);
    const dana = await readObject(orgA.member.ctx, { key: { kind: "email", value: DANA } });
    expect(dana.facts.map((fact) => fact.statement)).toEqual([ROLE]);
    expect((await getMemorySettings(orgA.admin.ctx)).started).toMatchObject({
      monthlyBudget: 500,
    });
  });

  it("tags every model call learning makes as memory in the ledger", async () => {
    const { orgA } = await setup();
    await startMemory(orgA.admin.ctx, { monthlyBudget: 500 });
    const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [
      { from: DANA, to: [orgA.member.email], text: "I lead procurement at Acme.", at: daysAgo(1) },
    ]);
    await backfillConnection(orgA.member.ctx, mailbox.id);
    scriptLearning({
      objects: [{ ref: "dana", kind: "person", name: "Dana Ruiz", email: DANA }],
      facts: [{ about: "dana", statement: ROLE, evidence: "I lead procurement at Acme" }],
    });
    await learnStoredItems(orgA.id);

    const usage = (await listLedger(orgA.admin.ctx)).filter((entry) => entry.kind === "usage");
    expect(usage.map((entry) => [entry.role ?? entry.modelId, entry.purpose]).sort()).toEqual([
      ["classify", "memory"],
      ["embed", "memory"],
      ["fast", "memory"],
      ["google/model-armor", "memory"],
    ]);
  });

  it("estimates from the emails and every version of each Google Doc, not other files", async () => {
    const { orgA } = await setup();
    const account = await connectGoogle(orgA.member.ctx, orgA.member.email, {
      messages: [{ from: DANA, to: [orgA.member.email], text: "Hi", at: daysAgo(3) }],
      files: [
        { name: "Notes", mimeType: GOOGLE_DOC, text: "Notes", at: daysAgo(3) },
        { name: "Numbers", mimeType: "application/vnd.google-apps.spreadsheet", at: daysAgo(3) },
      ],
    });
    await backfillConnection(orgA.member.ctx, account.id);
    expect((await getMemorySettings(orgA.admin.ctx)).estimate.items).toBe(2);

    const doc = account.files.at(0);
    account.drive.modify(doc?.id ?? "", new Date(), orgA.member.email, "Notes, edited");
    await pollConnection(systemCtx(orgA.id), account.id);

    expect((await getMemorySettings(orgA.admin.ctx)).estimate.items).toBe(3);
  });

  it("starts once", async () => {
    const { orgA } = await setup();
    await startMemory(orgA.admin.ctx, { monthlyBudget: 500 });

    await expect(startMemory(orgA.admin.ctx, { monthlyBudget: 50 })).rejects.toThrow(ConflictError);
  });
});

describe("the monthly budget", () => {
  // A budget of 1 credit, which one classify call at $0.002 (2 credits) spends.
  async function spentBudget() {
    const orgs = await setup();
    const { orgA } = orgs;
    await startMemory(orgA.admin.ctx, { monthlyBudget: 1 });
    const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [
      { from: "news@deals.example", to: [orgA.member.email], text: "Offers", at: daysAgo(2) },
    ]);
    await backfillConnection(orgA.member.ctx, mailbox.id);
    classifiedAs("newsletter", "email", { costUsd: 0.002 });
    expect(await learnStoredItems(orgA.id)).toEqual([
      { outcome: "skipped", reason: "not_business" },
    ]);
    mailbox.mailbox.add({
      from: `Dana Ruiz <${DANA}>`,
      to: [orgA.member.email],
      text: "I lead procurement at Acme.",
      at: new Date(),
    });
    await pollConnection(systemCtx(orgA.id), mailbox.id);
    return orgs;
  }

  it("stops learning once the month's spending reaches it", async () => {
    const { orgA } = await spentBudget();

    expect(await learnStoredItems(orgA.id)).toEqual([{ outcome: "skipped", reason: "postponed" }]);
    // Only the first email's classify call reached the gateway.
    expect(fakeAiGateway.requests()).toHaveLength(1);
    const settings = await getMemorySettings(orgA.admin.ctx);
    expect(settings.spentThisMonth).toBeGreaterThanOrEqual(2);
    expect(settings.postponedItems).toBe(1);
  });

  it("learns what it postponed when the next month starts", async () => {
    const { orgA } = await spentBudget();
    await learnStoredItems(orgA.id);
    const now = new Date();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 1));

    expect(await resumePostponed(systemCtx(orgA.id))).toEqual({ queued: 1 });
    classifiedAs("newsletter", "email", { costUsd: 0.002 });
    expect(await learnStoredItems(orgA.id)).toEqual([
      { outcome: "skipped", reason: "not_business" },
    ]);
    const settings = await getMemorySettings(orgA.admin.ctx);
    expect(settings.postponedItems).toBe(0);
  });

  it("tries what it postponed again when an admin raises it", async () => {
    const { orgA } = await spentBudget();
    await learnStoredItems(orgA.id);

    await setMemoryBudget(orgA.admin.ctx, { monthlyBudget: 100 });

    expect(fakeInngest.sent("memory/postponed.due").map((event) => event.data)).toEqual([
      { orgId: orgA.id },
    ]);
    expect(await resumePostponed(systemCtx(orgA.id))).toEqual({ queued: 1 });
    classifiedAs("newsletter");
    expect(await learnStoredItems(orgA.id)).toEqual([
      { outcome: "skipped", reason: "not_business" },
    ]);
  });

  it("caps learning only: a member's summaries don't count toward it", async () => {
    const { orgA } = await setup();
    // 5 credits: less than the summary below, more than the first classify call.
    await startMemory(orgA.admin.ctx, { monthlyBudget: 5 });
    const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [
      {
        from: `Dana Ruiz <${DANA}>`,
        to: [orgA.member.email],
        text: "I lead procurement at Acme.",
        at: daysAgo(2),
      },
    ]);
    await backfillConnection(orgA.member.ctx, mailbox.id);
    scriptLearning({
      objects: [{ ref: "dana", kind: "person", name: "Dana Ruiz", email: DANA }],
      facts: [{ about: "dana", statement: ROLE, evidence: "I lead procurement at Acme" }],
    });
    expect(await learnStoredItems(orgA.id)).toEqual([{ outcome: "learned", objects: 1, facts: 1 }]);
    const afterLearning = (await getMemorySettings(orgA.admin.ctx)).spentThisMonth;

    // The member's summary costs 50 credits, ten times the budget, and isn't added up.
    fakeAiGateway.text("Dana Ruiz leads procurement at Acme.", { costUsd: 0.05 });
    await summarizeObject(orgA.member.ctx, { key: { kind: "email", value: DANA } });
    expect((await getMemorySettings(orgA.admin.ctx)).spentThisMonth).toBe(afterLearning);

    // So learning goes on, and what it spends still counts: a 3-credit classify call...
    const next = (text: string) => {
      mailbox.mailbox.add({
        from: "news@deals.example",
        to: [orgA.member.email],
        text,
        at: new Date(),
      });
    };
    next("Offers");
    await pollConnection(systemCtx(orgA.id), mailbox.id);
    classifiedAs("newsletter", "email", { costUsd: 0.003 });
    expect(await learnStoredItems(orgA.id)).toEqual([
      { outcome: "skipped", reason: "not_business" },
    ]);
    expect((await getMemorySettings(orgA.admin.ctx)).spentThisMonth).toBeCloseTo(afterLearning + 3);
    // ...and another reaches the budget, which postpones the next item.
    next("More offers");
    await pollConnection(systemCtx(orgA.id), mailbox.id);
    classifiedAs("newsletter", "email", { costUsd: 0.003 });
    expect(await learnStoredItems(orgA.id)).toEqual([
      { outcome: "skipped", reason: "not_business" },
    ]);
    next("Even more offers");
    await pollConnection(systemCtx(orgA.id), mailbox.id);
    expect(await learnStoredItems(orgA.id)).toEqual([{ outcome: "skipped", reason: "postponed" }]);
  });

  it("can't be changed before memory starts", async () => {
    const { orgA } = await setup();

    await expect(setMemoryBudget(orgA.admin.ctx, { monthlyBudget: 10 })).rejects.toThrow(
      ConflictError,
    );
  });
});

describe("running out of credits", () => {
  it("postpones the item, and learns it once credits are granted", async () => {
    const { orgA } = await seedTwoOrgs();
    // Memory started, with a budget, but the org has no credits at all.
    await startMemory(systemCtx(orgA.id), { monthlyBudget: 1000 });
    const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [
      {
        from: `Dana Ruiz <${DANA}>`,
        to: [orgA.member.email],
        text: "I lead procurement at Acme.",
        at: daysAgo(2),
      },
    ]);
    await backfillConnection(orgA.member.ctx, mailbox.id);

    expect(await learnStoredItems(orgA.id)).toEqual([{ outcome: "skipped", reason: "postponed" }]);
    expect((await getMemorySettings(orgA.admin.ctx)).postponedItems).toBe(1);

    // Credits are granted, and `credits/granted`'s job resumes what waited for them.
    await grantCredits(systemCtx(orgA.id), 1000);
    expect(await resumePostponed(systemCtx(orgA.id), ["credits"])).toEqual({ queued: 1 });
    scriptLearning({
      objects: [{ ref: "dana", kind: "person", name: "Dana Ruiz", email: DANA }],
      facts: [{ about: "dana", statement: ROLE, evidence: "I lead procurement at Acme" }],
    });
    expect(await learnStoredItems(orgA.id)).toEqual([{ outcome: "learned", objects: 1, facts: 1 }]);
    expect((await getMemorySettings(orgA.admin.ctx)).postponedItems).toBe(0);
  });
});

describe("memory's settings", () => {
  it("are out of a member's reach", async () => {
    const { orgA } = await setup();
    await startMemory(orgA.admin.ctx, { monthlyBudget: 500 });
    const exclusion = await addExclusion(orgA.admin.ctx, { kind: "domain", value: "hr.example" });
    const member = orgA.member.ctx;

    await expect(getMemorySettings(member)).rejects.toThrow(ForbiddenError);
    await expect(startMemory(member, { monthlyBudget: 5 })).rejects.toThrow(ForbiddenError);
    await expect(setMemoryBudget(member, { monthlyBudget: 5 })).rejects.toThrow(ForbiddenError);
    await expect(addExclusion(member, { kind: "domain", value: "x.example" })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(removeExclusion(member, exclusion.id)).rejects.toThrow(ForbiddenError);
    const settings = await getMemorySettings(orgA.admin.ctx);
    expect(settings.started?.monthlyBudget).toBe(500);
    expect(settings.exclusions.map(({ kind, value }) => ({ kind, value }))).toEqual([
      { kind: "domain", value: "hr.example" },
    ]);
  });
});
