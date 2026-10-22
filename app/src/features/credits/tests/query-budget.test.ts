// Every model call checks credits first (invariant 7), and the ledger grows by a row per call, so
// the check must cost the same however long the ledger is.
import { beforeEach, describe, expect, it } from "vitest";
import { countQueries } from "@/db/testing/count-queries";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx } from "@/lib/ctx";
import { checkCredits, grantCredits, recordUsage } from "../server";

beforeEach(resetDatabase);

describe("checkCredits' query budget", () => {
  it("makes one query that returns one row, whether the ledger has 1 entry or 20", async () => {
    const { orgA } = await seedTwoOrgs();
    const system = systemCtx(orgA.id);
    await grantCredits(system, 100);

    const short = await countQueries(() => checkCredits(orgA.admin.ctx, 1));
    for (let call = 0; call < 19; call += 1) {
      await recordUsage(system, {
        role: "fast",
        modelId: "openai/x",
        costUsd: 0.001,
        outcome: "succeeded",
      });
    }
    const long = await countQueries(() => checkCredits(orgA.admin.ctx, 1));

    expect(short).toEqual({ queries: 1, rows: 1 });
    expect(long).toEqual(short);
  });
});
