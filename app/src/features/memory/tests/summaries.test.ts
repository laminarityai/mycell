// Summaries (ADR-0023): built when asked, by one `fast` call over only the facts the caller can
// see, metered, and never stored.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { tablesHolding } from "@/db/testing/content-scan";
import { seedTwoOrgs, seedUser } from "@/db/testing/two-org-fixture";
import { listLedger } from "@/features/credits/server";
import { backfillConnection } from "@/features/discovery/server";
import { systemCtx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { connectMailbox, daysAgo } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { listAccessLog, summarizeObject } from "../server";
import { learnStoredItems, scriptLearning, withCredits } from "./memory-helpers";

beforeEach(resetDatabase);

const DANA = "dana@acme.example";
const ROLE = "Dana Ruiz leads procurement at Acme.";
const DEMO = "Dana Ruiz asked for a demo of the oak range.";
const SUMMARY = "Dana Ruiz runs procurement at Acme (summary-marker-7781).";
const byDana = { key: { kind: "email" as const, value: DANA } };
const dana = { ref: "dana", kind: "person" as const, name: "Dana Ruiz", email: DANA };

// Dana writes to the member about her role, and separately to Lee asking for a demo.
async function setup() {
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  await withCredits(orgA.id);
  const lee = await seedUser(orgA.id, `lee@${orgA.workspaceDomain}`, "member");
  const memberBox = await connectMailbox(orgA.member.ctx, orgA.member.email, [
    {
      from: `Dana Ruiz <${DANA}>`,
      to: [orgA.member.email],
      text: "I lead procurement at Acme.",
      at: daysAgo(3),
    },
  ]);
  await backfillConnection(orgA.member.ctx, memberBox.id);
  scriptLearning({
    objects: [dana],
    facts: [{ about: "dana", statement: ROLE, evidence: "I lead procurement at Acme" }],
  });
  await learnStoredItems(orgA.id);
  const leeBox = await connectMailbox(lee.ctx, lee.email, [
    {
      from: `Dana Ruiz <${DANA}>`,
      to: [lee.email],
      text: "Could we see a demo of the oak range?",
      at: daysAgo(2),
    },
  ]);
  await backfillConnection(lee.ctx, leeBox.id);
  scriptLearning({
    objects: [dana],
    facts: [{ about: "dana", statement: DEMO, evidence: "Could we see a demo of the oak range?" }],
  });
  await learnStoredItems(orgA.id);
  return { ...orgs, lee };
}

/** What the summary call sent the model: its system text and prompt. */
function summaryRequest(): string {
  return JSON.stringify(fakeAiGateway.requests("language").at(-1)?.body);
}

describe("a summary of an object", () => {
  it("is built on `fast` from only the facts the caller can see, and never stored", async () => {
    const { orgA, lee } = await setup();
    const before = (await listLedger(orgA.admin.ctx)).length;

    fakeAiGateway.text(SUMMARY, { costUsd: 0.001 });
    const summary = await summarizeObject(orgA.member.ctx, byDana);

    expect(summary).toEqual({
      object: {
        id: expect.any(String) as string,
        kind: "person",
        name: "Dana Ruiz",
        keys: [{ kind: "email", value: DANA }],
      },
      summary: SUMMARY,
      factCount: 1,
    });
    expect(summaryRequest()).toContain(ROLE);
    expect(summaryRequest()).not.toContain(DEMO);
    // One metered call on `fast`.
    const ledger = await listLedger(orgA.admin.ctx);
    expect(ledger).toHaveLength(before + 1);
    expect(ledger[0]).toMatchObject({ kind: "usage", role: "fast", outcome: "succeeded" });
    expect(await tablesHolding("summary-marker-7781")).toEqual([]);

    fakeAiGateway.text("Dana Ruiz asked Lee for a demo.");
    await summarizeObject(lee.ctx, byDana);
    expect(summaryRequest()).toContain(DEMO);
    expect(summaryRequest()).not.toContain(ROLE);
  });

  it("is not found, with no model call, for a caller who can see no fact about it", async () => {
    const { orgA } = await setup();
    const before = (await listLedger(orgA.admin.ctx)).length;
    const calls = fakeAiGateway.requests("language").length;

    // The admin is on neither email, and the system ctx sees only what's company-wide.
    for (const ctx of [orgA.admin.ctx, systemCtx(orgA.id)]) {
      await expect(summarizeObject(ctx, byDana)).rejects.toThrow(NotFoundError);
    }

    expect(fakeAiGateway.requests("language")).toHaveLength(calls);
    expect(await listLedger(orgA.admin.ctx)).toHaveLength(before);
  });

  it("logs its read as the reader the caller names", async () => {
    const { orgA } = await setup();

    fakeAiGateway.text(SUMMARY);
    await summarizeObject(orgA.member.ctx, byDana, { kind: "builder" });

    const [entry] = await listAccessLog(orgA.admin.ctx);
    expect(entry).toMatchObject({
      operation: "read_object",
      reader: { kind: "builder", userId: orgA.member.id },
      factCount: 1,
    });
  });
});
