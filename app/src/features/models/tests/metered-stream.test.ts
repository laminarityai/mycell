import { streamText } from "ai";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits, listLedger } from "@/features/credits/server";
import { systemCtx } from "@/lib/ctx";
import { OutOfCreditsError } from "@/lib/errors";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { openMeteredStream, setModelRole } from "../server";

beforeEach(resetDatabase);

describe("openMeteredStream", () => {
  it("streams from the org's model for the role and records one entry for every step", async () => {
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    await grantCredits(systemCtx(orgA.id), 100);
    await setModelRole(admin, "smart", "org-a/smart");
    fakeAiGateway.reply({ text: "Hello there." }, { costUsd: 0.004 });

    const metered = await openMeteredStream(admin, "smart", { workflowId: "w-1" });
    const result = streamText({
      model: metered.model,
      prompt: "Hi",
      onStepEnd: (step) => {
        metered.meterStep(step.providerMetadata);
      },
    });
    expect(await result.text).toBe("Hello there.");
    await metered.finish("succeeded");
    await metered.finish("failed");

    expect(fakeAiGateway.requests("language").map((r) => [r.modelId, r.streaming])).toEqual([
      ["org-a/smart", true],
    ]);
    expect(await listLedger(admin)).toEqual([
      expect.objectContaining({
        kind: "usage",
        role: "smart",
        modelId: "org-a/smart",
        costUsd: 0.004,
        amount: -4,
        outcome: "succeeded",
        workflowId: "w-1",
      }),
      expect.objectContaining({ kind: "grant" }),
    ]);
  });

  it("refuses before anything is sent when the balance can't cover the role", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(openMeteredStream(orgA.admin.ctx, "smart")).rejects.toThrow(OutOfCreditsError);
    expect(fakeAiGateway.requests()).toEqual([]);
  });
});
