// Archiving a workflow (M5): an admin stops it everywhere and hides it from members, keeping
// everyone's enablements so that restoring brings them back as they were.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { connectGoogle } from "@/testing/connect-helpers";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import {
  archiveWorkflow,
  enable,
  getVisibleWorkflow,
  getWorkflow,
  listEnablements,
  listVisibleWorkflows,
  listWorkflows,
  restoreWorkflow,
} from "../server";
import { labelSpec } from "./specs";

beforeEach(resetDatabase);

// Org A: the member has `sales`, a label workflow is published to it, and the member has it on.
async function enabledBySales() {
  const orgs = await seedTwoOrgs();
  const { admin, member } = orgs.orgA;
  await connectGoogle(admin.ctx, admin.email);
  await connectGoogle(member.ctx, member.email);
  await tagUsers(admin.ctx, "sales", [member]);
  const { workflowId } = await publishTo(admin.ctx, "Labels", labelSpec(), ["sales"]);
  await enable(member.ctx, workflowId);
  return { ...orgs, admin, member, workflowId };
}

describe("archiving a workflow", () => {
  it("hides it from members, and keeps their enablements", async () => {
    const { admin, member, workflowId } = await enabledBySales();

    await archiveWorkflow(admin.ctx, workflowId);

    expect(await listVisibleWorkflows(member.ctx)).toEqual([]);
    await expect(getVisibleWorkflow(member.ctx, workflowId)).rejects.toThrow(NotFoundError);
    expect((await listEnablements(admin.ctx, workflowId)).map((e) => e.userId)).toEqual([
      member.id,
    ]);
  });

  it("shows admins it's archived", async () => {
    const { admin, workflowId } = await enabledBySales();

    await archiveWorkflow(admin.ctx, workflowId);

    expect((await listWorkflows(admin.ctx)).at(0)?.archivedAt).toEqual(expect.any(Date));
    expect((await getWorkflow(admin.ctx, workflowId)).archivedAt).toEqual(expect.any(Date));
  });

  it("refuses a member, archiving or restoring", async () => {
    const { admin, member, workflowId } = await enabledBySales();

    await expect(archiveWorkflow(member.ctx, workflowId)).rejects.toThrow(ForbiddenError);
    await archiveWorkflow(admin.ctx, workflowId);
    await expect(restoreWorkflow(member.ctx, workflowId)).rejects.toThrow(ForbiddenError);
    await expect(getVisibleWorkflow(member.ctx, workflowId)).rejects.toThrow(NotFoundError);
  });

  it("is 'not found' for another org's workflow", async () => {
    const { orgB, workflowId } = await enabledBySales();

    await expect(archiveWorkflow(orgB.admin.ctx, workflowId)).rejects.toThrow(NotFoundError);
    await expect(restoreWorkflow(orgB.admin.ctx, workflowId)).rejects.toThrow(NotFoundError);
  });
});

describe("restoring a workflow", () => {
  it("shows it to members again, with their enablement on, and makes no version", async () => {
    const { admin, member, workflowId } = await enabledBySales();
    await archiveWorkflow(admin.ctx, workflowId);

    await restoreWorkflow(admin.ctx, workflowId);

    expect(await getVisibleWorkflow(member.ctx, workflowId)).toMatchObject({
      versionNumber: 1,
      switch: { kind: "member", status: "on" },
    });
    const details = await getWorkflow(admin.ctx, workflowId);
    expect(details.versions).toHaveLength(1);
    expect(details.archivedAt).toBeNull();
  });
});
