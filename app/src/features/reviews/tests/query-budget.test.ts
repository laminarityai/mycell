// The Workflows page counts every workflow's reviews on each load, so the count must make the
// same number of queries for 1 workflow as for 10: counted together, never once per workflow.
import { beforeEach, describe, expect, it } from "vitest";
import { countQueries } from "@/db/testing/count-queries";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { connectMailbox } from "@/testing/connect-helpers";
import { reviewCountsByWorkflow } from "../server";
import { publish, replySpec } from "./review-helpers";
import { reviewEnded } from "./stats-helpers";

beforeEach(resetDatabase);

type Listed = { id: string; name: string }[];

/** Org A with 10 workflows, each with one review the member approved in their own mailbox. */
async function tenWorkflowsReviewed() {
  const { orgA } = await seedTwoOrgs();
  const system = systemCtx(orgA.id);
  await connectMailbox(orgA.admin.ctx, orgA.admin.email);
  const mailbox = await connectMailbox(orgA.member.ctx, orgA.member.email);
  const workflows: Listed = [];
  for (let n = 1; n <= 10; n += 1) {
    const name = `Replies ${String(n)}`;
    const spec = { ...replySpec(), id: `replies-${String(n)}` };
    const published = await publish(orgA.admin.ctx, spec, name);
    await reviewEnded(orgA.member, mailbox, system, published, "approved");
    workflows.push({ id: published.workflowId, name });
  }
  return { orgA, workflows };
}

const queries = async (ctx: Ctx, workflows: Listed, period: "7d" | "current_version") =>
  (await countQueries(() => reviewCountsByWorkflow(ctx, workflows, period))).queries;

describe("reviewCountsByWorkflow's query budget", () => {
  it("makes the same queries for 1 workflow as for 10", async () => {
    const { orgA, workflows } = await tenWorkflowsReviewed();
    const budget = async (listed: Listed) => ({
      // The counts, and the names to count each person's under.
      admin: await queries(orgA.admin.ctx, listed, "7d"),
      // The counts, the names, and each workflow's current version.
      sinceCurrentVersion: await queries(orgA.admin.ctx, listed, "current_version"),
      // A member's own counts only.
      member: await queries(orgA.member.ctx, listed, "7d"),
    });

    const one = await budget(workflows.slice(0, 1));
    const ten = await budget(workflows);

    expect(one).toEqual({ admin: 2, sinceCurrentVersion: 3, member: 1 });
    expect(ten).toEqual(one);
  });

  it("still counts each workflow apart", async () => {
    const { orgA, workflows } = await tenWorkflowsReviewed();

    const rows = await reviewCountsByWorkflow(orgA.admin.ctx, workflows, "current_version");

    expect(rows.map((row) => [row.label, row.tally.approvals.approved])).toEqual(
      workflows.flatMap((workflow) => [
        [workflow.name, 1],
        [orgA.member.email, 1],
      ]),
    );
  });
});
