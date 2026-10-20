import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx } from "@/lib/ctx";
import { ForbiddenError, OutOfCreditsError, ValidationError } from "@/lib/errors";
import { checkCredits, getBalance, grantCredits, listLedger, recordUsage } from "../server";

beforeEach(resetDatabase);

describe("the credit balance", () => {
  it("starts at zero", async () => {
    const { orgA } = await seedTwoOrgs();

    expect(await getBalance(orgA.admin.ctx)).toBe(0);
  });

  it("goes up by a grant and down by each usage, at 1000 credits per dollar", async () => {
    const { orgA } = await seedTwoOrgs();

    await grantCredits(systemCtx(orgA.id), 100);
    await recordUsage(orgA.admin.ctx, {
      role: "fast",
      modelId: "openai/x",
      costUsd: 0.0125,
      outcome: "succeeded",
    });

    expect(await getBalance(orgA.admin.ctx)).toBeCloseTo(87.5);
  });

  it("only lets our team grant credits, through the system ctx", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(grantCredits(orgA.admin.ctx, 100)).rejects.toThrow(ForbiddenError);
    await expect(grantCredits(systemCtx(orgA.id), 0)).rejects.toThrow(ValidationError);
    expect(await getBalance(orgA.admin.ctx)).toBe(0);
  });
});

describe("checkCredits", () => {
  it("passes when the balance covers the estimate", async () => {
    const { orgA } = await seedTwoOrgs();
    await grantCredits(systemCtx(orgA.id), 10);

    await expect(checkCredits(orgA.admin.ctx, 10)).resolves.toBeUndefined();
  });

  it("throws OutOfCreditsError when the balance is below the estimate", async () => {
    const { orgA } = await seedTwoOrgs();
    await grantCredits(systemCtx(orgA.id), 4);

    await expect(checkCredits(orgA.admin.ctx, 5)).rejects.toThrow(OutOfCreditsError);
  });
});

describe("listLedger", () => {
  it("lists entries newest first, with what each usage was for", async () => {
    const { orgA } = await seedTwoOrgs();
    await grantCredits(systemCtx(orgA.id), 50);
    await recordUsage(systemCtx(orgA.id), {
      role: "classify",
      modelId: "typesafe-ai/jev-1.14.0",
      costUsd: 0,
      outcome: "failed",
      generationId: "gen_1",
      workflowId: "wf_1",
      runId: "run_1",
    });

    expect(await listLedger(orgA.admin.ctx)).toMatchObject([
      {
        kind: "usage",
        amount: 0,
        role: "classify",
        modelId: "typesafe-ai/jev-1.14.0",
        costUsd: 0,
        outcome: "failed",
        generationId: "gen_1",
        workflowId: "wf_1",
        runId: "run_1",
      },
      { kind: "grant", amount: 50, role: null, costUsd: null },
    ]);
  });

  it("is out of a member's reach", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(listLedger(orgA.member.ctx)).rejects.toThrow(ForbiddenError);
  });
});
