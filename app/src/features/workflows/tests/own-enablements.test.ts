// What a person has switched on for their own inbox, for Ask Mycel (#181): their enablements of
// member-credential workflows that aren't archived, each with every pause that holds, which
// `pausedText` puts in the Workflows page's words. An org switch isn't anyone's own, and being
// an admin adds nothing: an admin's list is a member's with the same switches.
import { beforeEach, describe, expect, it } from "vitest";
import { countQueries } from "@/db/testing/count-queries";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits } from "@/features/credits/server";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { ForbiddenError } from "@/lib/errors";
import { connectGoogle, connectMailbox } from "@/testing/connect-helpers";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import {
  archiveWorkflow,
  enable,
  listOwnEnablements,
  pausedText,
  publishWorkflow,
  saveWorkflow,
  switchWorkflowOn,
} from "../server";
import { labelSpec } from "./specs";

beforeEach(resetDatabase);

// Org A, in credit: the member has `sales`, and a label workflow is published to it.
async function published() {
  const { orgA } = await seedTwoOrgs();
  const { admin, member } = orgA;
  await grantCredits(systemCtx(orgA.id), 100);
  await connectGoogle(admin.ctx, admin.email);
  await connectGoogle(member.ctx, member.email);
  const sales = await tagUsers(admin.ctx, "sales", [member]);
  const { workflowId } = await publishTo(admin.ctx, "Labels", labelSpec(), ["sales"]);
  return { orgA, admin, member, sales, workflowId };
}

const reply = {
  id: "reply",
  type: "draft",
  role: "smart",
  instructions: "Reply with our current prices.",
  context: ["trigger.message"],
  output: "google-mail.create-draft",
};

// A version that drafts replies too, which is riskier: every enablement pauses for its OK.
async function publishRiskier(admin: Ctx, workflowId: string) {
  const steps = [...(labelSpec().steps as unknown[]), reply];
  const spec = labelSpec({ steps, visibility: { tags: ["sales"] } });
  await saveWorkflow(admin, { workflowId, name: "Labels", spec });
  await publishWorkflow(admin, workflowId);
}

describe("listOwnEnablements", () => {
  it("lists the member's enablement, not an org switch or an archived workflow", async () => {
    const { admin, member, workflowId } = await published();
    await enable(member.ctx, workflowId);
    const old = await publishTo(admin.ctx, "Old labels", labelSpec({ id: "old" }), ["sales"]);
    await enable(member.ctx, old.workflowId);
    await archiveWorkflow(admin.ctx, old.workflowId);
    const inbox = await connectMailbox(admin.ctx, "support@org-a.test", [], "org");
    const shared = await publishTo(
      admin.ctx,
      "Support labels",
      labelSpec({ id: "support", credentials: "org" }),
      ["sales"],
    );
    await switchWorkflowOn(admin.ctx, shared.workflowId, inbox.id);

    expect(await listOwnEnablements(member.ctx)).toEqual([
      {
        workflowId,
        name: "Labels",
        since: expect.any(Date) as Date,
        pauses: [],
        pausedChange: null,
      },
    ]);
    // The org switch is no one's own.
    expect(await listOwnEnablements(admin.ctx)).toEqual([]);
  });

  it("gives an admin the same as a member with the same switch", async () => {
    const { admin, member, workflowId } = await published();
    await enable(member.ctx, workflowId);
    await enable(admin.ctx, workflowId);

    const withoutSince = async (ctx: Ctx) =>
      (await listOwnEnablements(ctx)).map(({ workflowId, name, pauses, pausedChange }) => ({
        workflowId,
        name,
        pauses,
        pausedChange,
      }));

    expect(await withoutSince(admin.ctx)).toEqual(await withoutSince(member.ctx));
  });

  it("says why each is paused, in the Workflows page's words", async () => {
    const { admin, member, workflowId } = await published();
    await enable(member.ctx, workflowId);
    await publishRiskier(admin.ctx, workflowId);

    const [paused] = await listOwnEnablements(member.ctx);

    expect(paused.pauses).toEqual(["needs_reenable"]);
    expect(pausedText(paused.pauses[0], paused.pausedChange)).toBe(
      "needs your OK for a riskier version",
    );
  });

  it("says a workflow is paused while the company is out of credits", async () => {
    const { orgA } = await seedTwoOrgs();
    const { admin, member } = orgA;
    await connectGoogle(admin.ctx, admin.email);
    await connectGoogle(member.ctx, member.email);
    await tagUsers(admin.ctx, "sales", [member]);
    const { workflowId } = await publishTo(admin.ctx, "Labels", labelSpec(), ["sales"]);
    await enable(member.ctx, workflowId);

    const [paused] = await listOwnEnablements(member.ctx);

    expect(paused.pauses).toEqual(["out_of_credits"]);
    expect(pausedText(paused.pauses[0], paused.pausedChange)).toBe("out of credits");
  });

  it("is for people only, not the system ctx", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(listOwnEnablements(systemCtx(orgA.id))).rejects.toThrow(ForbiddenError);
  });
});

describe("listOwnEnablements' query budget", () => {
  it("makes the same queries for 1 enablement as for 3", async () => {
    const { admin, member, workflowId } = await published();
    await enable(member.ctx, workflowId);
    const one = await countQueries(() => listOwnEnablements(member.ctx));
    for (const n of [2, 3]) {
      const spec = labelSpec({ id: `labels-${String(n)}` });
      const more = await publishTo(admin.ctx, `Labels ${String(n)}`, spec, ["sales"]);
      await enable(member.ctx, more.workflowId);
    }

    const three = await countQueries(() => listOwnEnablements(member.ctx));

    expect((await listOwnEnablements(member.ctx)).length).toBe(3);
    expect(three.queries).toBe(one.queries);
  });
});
