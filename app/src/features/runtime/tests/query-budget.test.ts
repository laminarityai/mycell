// The Runs page lists up to 100 runs a page across every workflow and inbox, so the list must
// make the same queries for 1 run as for 100: read together, never once per run, version or
// connection. A run's page likewise reads its steps together, however many it has.
import { beforeEach, describe, expect, it } from "vitest";
import { countQueries } from "@/db/testing/count-queries";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits } from "@/features/credits/server";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { connectMailbox } from "@/testing/connect-helpers";
import { executeRun, getRun, getRunMessage, listRuns, startRun } from "../server";
import { company, readStep } from "./company-runs";
import { connectInbox, pricingQuestion, publish, threadSpec } from "./run-helpers";

beforeEach(resetDatabase);

describe("listRuns' query budget", () => {
  it("makes the same queries for 1 run as for 100, across workflows and inboxes", async () => {
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    const promoted: Ctx = { ...orgA.member.ctx, role: "admin" };
    const system = systemCtx(orgA.id);
    await grantCredits(system, 100);
    const own = await connectInbox(admin, orgA.admin.email, [pricingQuestion()]);
    const colleague = await connectInbox(orgA.member.ctx, orgA.member.email, [pricingQuestion()]);
    const shared = await connectMailbox(admin, `sales@${orgA.workspaceDomain}`, [], "org");
    shared.mailbox.add(pricingQuestion());
    const replies = await publish(admin, threadSpec({ id: "replies", steps: [readStep] }));
    const sales = await publish(
      admin,
      threadSpec({ id: "sales", credentials: "org", steps: [readStep] }),
    );
    // The runs on members' inboxes fail their read on a missing message; the org's are still
    // running.
    const start = async (n: number) => {
      const [ctx, connectionId, workflowId] = [
        [admin, own.connectionId, replies],
        [promoted, colleague.connectionId, replies],
        [admin, shared.id, sales],
      ][n % 3] as [Ctx, string, string];
      const failing = n % 3 !== 2;
      const { runId } = await startRun(ctx, workflowId, connectionId, `message-${String(n)}`);
      if (failing) await executeRun(system, runId);
    };
    const budget = async () => ({
      admin: await countQueries(() => listRuns(admin, {}, { size: 100 })),
      member: await countQueries(() => listRuns(orgA.member.ctx, {}, { size: 100 })),
    });

    await start(0);
    await start(1);
    const one = await budget();
    for (let n = 2; n < 150; n += 1) await start(n);
    const hundred = await budget();

    expect((await listRuns(admin, {}, { size: 100 })).runs).toHaveLength(100);
    expect((await listRuns(orgA.member.ctx, {}, { size: 100 })).runs).toHaveLength(50);
    // Whose each connection is (2), the page, its failed steps, their versions, the workflows'
    // names, and the connections to fetch subjects through.
    expect(one.admin.queries).toBe(7);
    expect(hundred.admin.queries).toBe(one.admin.queries);
    expect(hundred.member.queries).toBe(one.member.queries);
  });
});

describe("a run's page's query budget", () => {
  it("makes the same queries for a run of 1 step as for one of 12, full or redacted", async () => {
    const { orgA, admin, member, own, colleague, run } = await company();
    const promoted: Ctx = { ...member, role: "admin" };
    const many = Array.from({ length: 12 }, (_, n) => ({ ...readStep, id: `read-${String(n)}` }));
    const long = await publish(admin, threadSpec({ id: "long", steps: many }));
    const runLong = async (ctx: Ctx, connectionId: string, sourceRef: string) => {
      const { runId } = await startRun(ctx, long, connectionId, sourceRef);
      await executeRun(systemCtx(orgA.id), runId);
      return runId;
    };
    const one = { own: await run("own", "succeeded"), colleague: await run("colleague", "failed") };
    const twelve = {
      own: await runLong(admin, own.connectionId, own.messages[0].id),
      colleague: await runLong(promoted, colleague.connectionId, colleague.messages[0].id),
    };
    const budget = async (ids: typeof one) => ({
      full: await countQueries(() => getRun(admin, ids.own)),
      redacted: await countQueries(() => getRun(admin, ids.colleague)),
      member: await countQueries(() => getRun(member, ids.colleague)),
      message: await countQueries(() => getRunMessage(admin, ids.own)),
    });

    expect((await getRun(admin, twelve.own)).steps).toHaveLength(12);
    const small = await budget(one);
    const large = await budget(twelve);

    // Whose each connection is (2), the run, its steps, its version, its workflow's name, its
    // retry, and, for a run shown in full, the company's custom actions, for its checks' words.
    expect(small.full.queries).toBe(8);
    expect(large.full.queries).toBe(small.full.queries);
    expect(large.redacted.queries).toBe(small.redacted.queries);
    expect(large.member.queries).toBe(small.member.queries);
    // The run, and its connection to fetch the message through.
    expect(small.message.queries).toBe(2);
    expect(large.message.queries).toBe(small.message.queries);
  });
});
