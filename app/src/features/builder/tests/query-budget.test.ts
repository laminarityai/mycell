// Every builder turn reads the org's workflows, connections and custom actions for its context,
// so the turn must make the same number of queries for 1 workflow as for 10: read together,
// never once per workflow.
import { beforeEach, describe, expect, it } from "vitest";
import { countQueries } from "@/db/testing/count-queries";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, type FixtureOrg } from "@/db/testing/two-org-fixture";
import { publishWorkflow, saveWorkflow } from "@/features/workflows/server";
import { connectGmail } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { startConversation, streamTurn } from "../server";
import { labelSpec } from "./specs";
import { fundOrg, readTurn } from "./turn-helpers";

beforeEach(resetDatabase);

// Saves workflows `from` to `to`, returning their IDs.
async function addWorkflows(org: FixtureOrg, from: number, to: number): Promise<string[]> {
  const ids: string[] = [];
  for (let n = from; n <= to; n += 1) {
    const { id } = await saveWorkflow(org.admin.ctx, {
      name: `Labels ${String(n)}`,
      spec: labelSpec({ id: `labels-${String(n)}` }),
    });
    // Every other one published, so the context names both kinds.
    if (n % 2 === 1) await publishWorkflow(org.admin.ctx, id);
    ids.push(id);
  }
  return ids;
}

// The queries one turn makes, from the admin's message to the stored reply, in a new
// conversation about the first workflow.
async function turnQueries(org: FixtureOrg, workflowId: string): Promise<number> {
  const { id } = await startConversation(org.admin.ctx, { workflowId });
  fakeAiGateway.reply({ text: "Hello." });
  const counted = await countQueries(async () =>
    readTurn(await streamTurn(org.admin.ctx, id, "What can you do?")),
  );
  return counted.queries;
}

describe("a builder turn's query budget", () => {
  it("makes the same queries for 1 workflow as for 10", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    await connectGmail(orgA.admin.ctx, orgA.admin.email);
    const [first = ""] = await addWorkflows(orgA, 1, 1);

    const one = await turnQueries(orgA, first);
    await addWorkflows(orgA, 2, 10);
    const ten = await turnQueries(orgA, first);

    expect(ten).toBe(one);
  });
});
