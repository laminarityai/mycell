import { beforeEach, describe, expect, it } from "vitest";
import { tablesHolding } from "@/db/testing/content-scan";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, seedUser } from "@/db/testing/two-org-fixture";
import { backfillConnection } from "@/features/discovery/server";
import { systemCtx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { connectMailbox, daysAgo } from "@/testing/connect-helpers";
import { listAccessLog, pruneAccessLog, readObject, searchMemory } from "../server";
import { ACCESS_LOG_RETENTION_DAYS } from "../types";
import { learnStoredItems, scriptLearning, withCredits } from "./memory-helpers";

beforeEach(resetDatabase);

const DANA = "dana@acme.example";
const BO = "bo@beta.example";
const ROLE = "Dana Ruiz leads procurement at Acme.";
const RENEWAL = "Acme's renewal is due in March.";
const QUERY_MARKER = "QUERYMARKER5521";
const byEmail = { key: { kind: "email" as const, value: DANA } };

// Dana at Acme writes to org A's member, copying its admin; Lee is on nothing.
async function setup() {
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  await withCredits(orgA.id);
  const lee = await seedUser(orgA.id, `lee@${orgA.workspaceDomain}`, "member");
  // Dana copied the admin: a copy is in the admin's mailbox too.
  const email = {
    from: `Dana Ruiz <${DANA}>`,
    to: [orgA.member.email],
    cc: [orgA.admin.email],
    subject: "Renewal",
    text: "I lead procurement at Acme. Our renewal is due in March.",
    at: daysAgo(2),
    headers: { "Message-ID": "<procurement-1@acme.example>" },
  };
  const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email, [email]);
  const adminBox = await connectMailbox(orgA.admin.ctx, orgA.admin.email, [email]);
  await backfillConnection(orgA.member.ctx, mailbox.id);
  await backfillConnection(orgA.admin.ctx, adminBox.id);
  scriptLearning({
    objects: [
      { ref: "dana", kind: "person", name: "Dana Ruiz", email: DANA },
      { ref: "acme", kind: "company", name: "Acme", domain: "acme.example" },
    ],
    facts: [
      { about: "dana", statement: ROLE, evidence: "I lead procurement at Acme", object: "acme" },
      { about: "acme", statement: RENEWAL, evidence: "Our renewal is due in March" },
    ],
  });
  await learnStoredItems(orgA.id);
  return { ...orgs, lee };
}

describe("logging reads of memory", () => {
  it("logs a search: who, which objects and facts, never the query or the facts", async () => {
    const { orgA } = await setup();

    const found = await searchMemory(orgA.member.ctx, { text: `procurement ${QUERY_MARKER}` });

    const log = await listAccessLog(orgA.admin.ctx);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      operation: "search",
      reader: { kind: "person", userId: orgA.member.id, name: orgA.member.email },
      factCount: found.facts.length,
    });
    expect(log[0]?.objects.map((object) => object.id).toSorted()).toEqual(
      found.objects.map((object) => object.id).toSorted(),
    );
    expect(await tablesHolding(QUERY_MARKER)).toEqual([]);
    expect(await tablesHolding(ROLE)).toEqual(["facts"]);
  });

  it("logs reading an object", async () => {
    const { orgA } = await setup();

    const dana = await readObject(orgA.admin.ctx, byEmail);

    const log = await listAccessLog(orgA.admin.ctx);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      operation: "read_object",
      reader: { kind: "person", userId: orgA.admin.id },
      objects: [{ id: dana.id, name: "Dana Ruiz" }],
      factCount: 1,
    });
  });

  it("logs a workflow run or the builder as what read, in whose view", async () => {
    const { orgA } = await setup();
    const run = { kind: "workflow_run" as const, runId: "run-1", workflowId: "workflow-1" };

    await readObject(orgA.member.ctx, byEmail, run);
    await searchMemory(systemCtx(orgA.id), { text: "procurement" }, run);
    await searchMemory(orgA.admin.ctx, byEmail, { kind: "builder" });

    const readers = (await listAccessLog(orgA.admin.ctx)).map((entry) => entry.reader);
    expect(readers).toEqual([
      expect.objectContaining({ kind: "builder", userId: orgA.admin.id, runId: null }),
      expect.objectContaining({ kind: "workflow_run", userId: null, runId: "run-1" }),
      expect.objectContaining({
        kind: "workflow_run",
        userId: orgA.member.id,
        runId: "run-1",
        workflowId: "workflow-1",
      }),
    ]);
  });

  it("logs nothing for an object the caller can't see", async () => {
    const { orgA, lee } = await setup();

    await expect(readObject(lee.ctx, byEmail)).rejects.toThrow(NotFoundError);

    expect(await listAccessLog(orgA.admin.ctx)).toEqual([]);
  });

  it("logs a search that finds nothing, and a system read as Mycel itself", async () => {
    const { orgA } = await setup();

    await searchMemory(systemCtx(orgA.id), { text: "procurement" });

    expect(await listAccessLog(orgA.admin.ctx)).toMatchObject([
      { operation: "search", reader: { kind: "system", userId: null }, objects: [], factCount: 0 },
    ]);
  });
});

describe("keeping the access log", () => {
  it("keeps each entry for a year, then the nightly prune deletes it", async () => {
    const { orgA, orgB } = await setup();
    await readObject(orgA.admin.ctx, byEmail);
    const inDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    expect(ACCESS_LOG_RETENTION_DAYS).toBeGreaterThanOrEqual(90);
    await expect(pruneAccessLog(orgA.admin.ctx, inDays(400))).rejects.toThrow(ForbiddenError);
    await pruneAccessLog(systemCtx(orgB.id), inDays(400));
    expect(await pruneAccessLog(systemCtx(orgA.id), inDays(364))).toEqual({
      entries: 0,
      consents: 0,
    });
    expect(await listAccessLog(orgA.admin.ctx)).toHaveLength(1);

    expect(await pruneAccessLog(systemCtx(orgA.id), inDays(366))).toEqual({
      entries: 1,
      consents: 0,
    });
    expect(await listAccessLog(orgA.admin.ctx)).toEqual([]);
  });
});

describe("who sees the access log", () => {
  // Bo at Beta writes to Lee alone, so memory learns a fact from Lee's own mailbox too.
  async function withLeesMail() {
    const orgs = await setup();
    const { orgA, lee } = orgs;
    const mailbox = await connectMailbox(lee.ctx, lee.email, [
      { from: `Bo <${BO}>`, to: [lee.email], text: "I run sales at Beta.", at: daysAgo(1) },
    ]);
    await backfillConnection(lee.ctx, mailbox.id);
    scriptLearning({
      objects: [{ ref: "bo", kind: "person", name: "Bo Lind", email: BO }],
      facts: [{ about: "bo", statement: "Bo Lind runs sales at Beta.", evidence: "I run sales" }],
    });
    await learnStoredItems(orgA.id);
    return orgs;
  }

  it("shows admins every read, and a member the reads of facts from their own sources", async () => {
    const { orgA, lee } = await withLeesMail();
    const bo = { key: { kind: "email" as const, value: BO } };

    // The admin reads Dana (from the member's mailbox), Lee reads Bo (from his own), and the
    // member searches for something memory doesn't hold.
    await readObject(orgA.admin.ctx, byEmail);
    await readObject(lee.ctx, bo);
    await searchMemory(orgA.member.ctx, { text: "invoices" });

    const reads = async (ctx: typeof lee.ctx) =>
      (await listAccessLog(ctx)).map((entry) => `${entry.reader.name ?? ""} ${entry.operation}`);
    expect(await reads(orgA.admin.ctx)).toEqual([
      `${orgA.member.email} search`,
      `${lee.email} read_object`,
      `${orgA.admin.email} read_object`,
    ]);
    expect(await reads(orgA.member.ctx)).toEqual([`${orgA.admin.email} read_object`]);
    expect(await reads(lee.ctx)).toEqual([`${lee.email} read_object`]);
  });

  it("names only the objects the viewer can see a fact about", async () => {
    const { orgA, lee } = await withLeesMail();

    await readObject(lee.ctx, { key: { kind: "email", value: BO } });

    const entry = (await listAccessLog(orgA.admin.ctx)).at(0);
    expect(entry?.objects).toEqual([{ id: expect.any(String) as string, name: null }]);
    expect(entry?.factCount).toBe(1);
  });

  it("is no one's to see as the system ctx", async () => {
    const { orgA } = await setup();

    await expect(listAccessLog(systemCtx(orgA.id))).rejects.toThrow(ForbiddenError);
  });
});
