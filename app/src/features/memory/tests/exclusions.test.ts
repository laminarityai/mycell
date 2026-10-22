import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { backfillConnection, pollConnection } from "@/features/discovery/server";
import { systemCtx } from "@/lib/ctx";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { connectDrive, connectMailbox, daysAgo } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import type { FakeMessageInput } from "@/testing/fake-gmail";
import { fakeInngest } from "@/testing/fake-inngest";
import {
  addExclusion,
  forgetExcluded,
  getMemorySettings,
  learnFromItem,
  readObject,
  removeExclusion,
} from "../server";
import { itemToLearnSchema } from "../types";
import { learnStoredItems, scriptDocLearning, scriptLearning, withCredits } from "./memory-helpers";

beforeEach(resetDatabase);

const DANA = "dana@acme.example";
const KIM = "kim@globex.example";
const ROLE = "Dana Ruiz leads procurement at Acme.";
const KIM_ROLE = "Kim Lee runs sales at Globex.";
const runInline = <T>(_id: string, run: () => Promise<T>) => run();
const byEmail = (value: string) => ({ key: { kind: "email" as const, value } });
const ACME_DOMAIN = { kind: "domain" as const, value: "acme.example" };

// Org A's member has a mailbox with an HR label, and memory has started.
async function setup() {
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  await withCredits(orgA.id);
  const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, []);
  const hr = mailbox.mailbox.writes.createLabel("HR");
  if (hr === undefined) throw new Error("The HR label wasn't made.");
  await backfillConnection(orgA.member.ctx, mailbox.id);
  const ctx = systemCtx(orgA.id);
  // An email arrives, and memory learns from it.
  const arrives = async (input: Omit<FakeMessageInput, "at">) => {
    mailbox.mailbox.add({ to: [orgA.member.email], at: new Date(), ...input });
    await pollConnection(ctx, mailbox.id);
    return learnStoredItems(orgA.id);
  };
  return { ...orgs, mailbox, hr, arrives };
}

const fromDana = { from: `Dana Ruiz <${DANA}>`, text: "Hi, I lead procurement at Acme." };
const fromKim = { from: `Kim Lee <${KIM}>`, text: "Hello, I run sales at Globex." };

function scriptDana() {
  scriptLearning({
    objects: [{ ref: "dana", kind: "person", name: "Dana Ruiz", email: DANA }],
    facts: [{ about: "dana", statement: ROLE, evidence: "I lead procurement at Acme" }],
  });
}

function scriptKim() {
  scriptLearning({
    objects: [{ ref: "kim", kind: "person", name: "Kim Lee", email: KIM }],
    facts: [{ about: "kim", statement: KIM_ROLE, evidence: "I run sales at Globex" }],
  });
}

// Adds the exclusion, and runs what its event starts.
async function exclude(
  ctx: Parameters<typeof addExclusion>[0],
  input: Parameters<typeof addExclusion>[1],
) {
  const exclusion = await addExclusion(ctx, input);
  const sent = fakeInngest.sent("memory/exclusion.added").at(-1);
  expect(sent?.data).toEqual({ orgId: ctx.orgId, exclusionId: exclusion.id });
  return { exclusion, forgot: await forgetExcluded(systemCtx(ctx.orgId), exclusion.id, runInline) };
}

describe("excluding a Gmail label", () => {
  it("removes what its emails taught, and skips its emails from then on", async () => {
    const { orgA, hr, arrives } = await setup();
    scriptDana();
    expect(await arrives({ ...fromDana, labelIds: ["INBOX", hr.id] })).toEqual([
      { outcome: "learned", objects: 1, facts: 1 },
    ]);
    scriptKim();
    expect(await arrives(fromKim)).toEqual([{ outcome: "learned", objects: 1, facts: 1 }]);

    // Gmail matches label names regardless of case.
    const { forgot } = await exclude(orgA.admin.ctx, { kind: "gmail_label", value: "hr" });

    expect(forgot).toEqual({ sourceRecords: 1 });
    await expect(readObject(orgA.member.ctx, byEmail(DANA))).rejects.toThrow(NotFoundError);
    const kim = await readObject(orgA.member.ctx, byEmail(KIM));
    expect(kim.facts.map((fact) => fact.statement)).toEqual([KIM_ROLE]);

    const requests = fakeAiGateway.requests().length;
    expect(await arrives({ ...fromDana, labelIds: ["INBOX", hr.id] })).toEqual([
      { outcome: "skipped", reason: "excluded" },
    ]);
    expect(fakeAiGateway.requests()).toHaveLength(requests);
    // The same sender, without the label, is learned from.
    scriptDana();
    expect(await arrives(fromDana)).toEqual([{ outcome: "learned", objects: 1, facts: 1 }]);
  });
});

describe("excluding an address or a domain", () => {
  it("removes what emails it's on taught, and skips them from then on", async () => {
    const { orgA, arrives } = await setup();
    scriptDana();
    await arrives(fromDana);
    scriptKim();
    await arrives(fromKim);

    const { forgot } = await exclude(orgA.admin.ctx, { kind: "domain", value: "@ACME.example" });

    expect(forgot).toEqual({ sourceRecords: 1 });
    await expect(readObject(orgA.member.ctx, byEmail(DANA))).rejects.toThrow(NotFoundError);
    expect((await readObject(orgA.member.ctx, byEmail(KIM))).facts).toHaveLength(1);
    expect(await arrives({ ...fromDana, from: "dana@eu.acme.example" })).toEqual([
      { outcome: "skipped", reason: "excluded" },
    ]);

    await exclude(orgA.admin.ctx, { kind: "address", value: KIM });
    await expect(readObject(orgA.member.ctx, byEmail(KIM))).rejects.toThrow(NotFoundError);
    // Copied on the email counts too.
    expect(await arrives({ from: "someone@else.example", cc: [KIM], text: "Hi" })).toEqual([
      { outcome: "skipped", reason: "excluded" },
    ]);
  });
});

describe("an exclusion added while an item is being learned", () => {
  it("keeps the item out though it was added between learning's two steps", async () => {
    const { orgA, mailbox } = await setup();
    mailbox.mailbox.add({ ...fromDana, to: [orgA.member.email], at: new Date() });
    await pollConnection(systemCtx(orgA.id), mailbox.id);
    const stored = fakeInngest.sent("discovery/item.stored").at(-1);
    scriptDana();

    // The admin excludes Acme, and the exclusion's job runs, after the item was decided on
    // and before it's extracted: the job finds nothing learned yet.
    let forgot: Awaited<ReturnType<typeof forgetExcluded>> | undefined;
    const interleaved = async <T>(id: string, run: () => Promise<T>) => {
      if (id === "extract") ({ forgot } = await exclude(orgA.admin.ctx, ACME_DOMAIN));
      return run();
    };
    const outcome = await learnFromItem(
      systemCtx(orgA.id),
      itemToLearnSchema.parse(stored?.data),
      interleaved,
    );

    expect(forgot).toEqual({ sourceRecords: 0 });
    expect(outcome).toEqual({ outcome: "skipped", reason: "excluded" });
    await expect(readObject(orgA.member.ctx, byEmail(DANA))).rejects.toThrow(NotFoundError);
  });
});

describe("excluding a Drive folder", () => {
  const FOLDER = "application/vnd.google-apps.folder";
  const DOC = "application/vnd.google-apps.document";
  const NOTES = "Account notes. Acme (acme.example) renews its contract in March.";
  const RENEWAL = "Acme renews its contract in March.";
  const byAcme = { key: { kind: "domain" as const, value: "acme.example" } };

  it("removes what docs in it, or in a folder under it, taught, and skips them from then on", async () => {
    const { orgA } = await seedTwoOrgs();
    await withCredits(orgA.id);
    const legal = "1LegalFolder000000";
    const contracts = "1ContractsFolder00";
    const drive = await connectDrive(orgA.member.ctx, orgA.member.email, [
      { id: legal, name: "Legal", mimeType: FOLDER, at: daysAgo(5) },
      { id: contracts, name: "Contracts", mimeType: FOLDER, at: daysAgo(5), parents: [legal] },
      { name: "Acme", mimeType: DOC, text: NOTES, at: daysAgo(2), parents: [contracts] },
    ]);
    await backfillConnection(orgA.member.ctx, drive.id);
    scriptDocLearning({
      objects: [{ ref: "acme", kind: "company", name: "Acme", domain: "acme.example" }],
      facts: [
        {
          about: "acme",
          statement: RENEWAL,
          evidence: "Acme (acme.example) renews its contract in March",
        },
      ],
    });
    // Only the doc is learned from; the folders aren't docs.
    expect(await learnStoredItems(orgA.id)).toContainEqual({
      outcome: "learned",
      objects: 1,
      facts: 1,
    });

    const { forgot } = await exclude(orgA.admin.ctx, {
      kind: "drive_folder",
      value: `https://drive.google.com/drive/folders/${legal}`,
    });

    expect(forgot).toEqual({ sourceRecords: 1 });
    await expect(readObject(orgA.member.ctx, byAcme)).rejects.toThrow(NotFoundError);
    // A new version of the doc is skipped, before any model reads it.
    const doc = drive.files.at(-1);
    drive.drive.modify(doc?.id ?? "", new Date(), orgA.member.email, `${NOTES} Updated.`);
    await pollConnection(systemCtx(orgA.id), drive.id);
    const requests = fakeAiGateway.requests().length;
    expect(await learnStoredItems(orgA.id)).toEqual([{ outcome: "skipped", reason: "excluded" }]);
    expect(fakeAiGateway.requests()).toHaveLength(requests);
  });
});

describe("exclusions", () => {
  it("are listed for admins, each once, and can be removed", async () => {
    const { orgA, arrives } = await setup();
    const { exclusion } = await exclude(orgA.admin.ctx, { kind: "address", value: DANA });
    await exclude(orgA.admin.ctx, {
      kind: "drive_folder",
      value: "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMn?usp=sharing",
    });

    await expect(addExclusion(orgA.admin.ctx, { kind: "address", value: DANA })).rejects.toThrow(
      ConflictError,
    );
    await expect(
      addExclusion(orgA.admin.ctx, { kind: "domain", value: "not a domain" }),
    ).rejects.toThrow(ValidationError);
    expect(
      (await getMemorySettings(orgA.admin.ctx)).exclusions.map(({ kind, value }) => [kind, value]),
    ).toEqual([
      ["address", DANA],
      ["drive_folder", "1AbCdEfGhIjKlMn"],
    ]);

    await removeExclusion(orgA.admin.ctx, exclusion.id);
    await expect(removeExclusion(orgA.admin.ctx, exclusion.id)).rejects.toThrow(NotFoundError);
    scriptDana();
    expect(await arrives(fromDana)).toEqual([{ outcome: "learned", objects: 1, facts: 1 }]);
  });
});
