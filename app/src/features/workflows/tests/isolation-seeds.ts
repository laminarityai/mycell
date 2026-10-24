// What the isolation cases (isolation-cases.ts) seed in org B, for each case to check org A
// can't reach it.
import { expect } from "vitest";
import { FUNDED_CREDITS, type TwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits } from "@/features/credits/server";
import { listTags } from "@/features/tags/server";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { connectGmail, connectMailbox } from "@/testing/connect-helpers";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import * as server from "../server";
import { draftSpec, labelSpec } from "./specs";

// Org B gets a published workflow, so every case can check org B is left exactly as it was.
export async function seedOrgBWorkflow({ orgA, orgB }: TwoOrgs) {
  await connectGmail(orgA.admin.ctx, orgA.admin.email);
  await connectGmail(orgB.admin.ctx, orgB.admin.email);
  const { id } = await server.saveWorkflow(orgB.admin.ctx, { name: "B", spec: draftSpec() });
  const version = await server.publishWorkflow(orgB.admin.ctx, id);
  return { id, version, before: await server.getWorkflow(orgB.admin.ctx, id) };
}

/** A case for an admin read of one workflow: org A's admin finds org B's workflow not there. */
export function orgBWorkflowNotFound(read: (ctx: Ctx, workflowId: string) => Promise<unknown>) {
  return async (orgs: TwoOrgs) => {
    const { id } = await seedOrgBWorkflow(orgs);

    await expect(read(orgs.orgA.admin.ctx, id)).rejects.toThrow(NotFoundError);
  };
}

// Org B's admin has a member workflow switched on for their own connection, and credits to run it.
export async function switchedOnInOrgB({ orgB }: TwoOrgs) {
  const admin = orgB.admin.ctx;
  await grantCredits(systemCtx(orgB.id), FUNDED_CREDITS);
  const own = await connectMailbox(admin, orgB.admin.email);
  const { id } = await server.saveWorkflow(admin, { name: "B", spec: labelSpec() });
  await server.publishWorkflow(admin, id);
  await server.switchWorkflowOn(admin, id, own.id);
  return { workflowId: id, connectionId: own.id, before: await server.getWorkflow(admin, id) };
}

// Org B publishes a workflow to its own `sales` tag, which its member has.
export async function publishedToSalesInOrgB({ orgB }: TwoOrgs) {
  await connectGmail(orgB.admin.ctx, orgB.admin.email);
  await tagUsers(orgB.admin.ctx, "sales", [orgB.member]);
  return publishTo(orgB.admin.ctx, "B", labelSpec(), ["sales"]);
}

// Org B's tag IDs.
export async function orgBTags({ orgB }: TwoOrgs): Promise<string[]> {
  return (await listTags(orgB.admin.ctx)).map((tag) => tag.id);
}

// versionsById's isolation case: org A reads none of org B's versions, whoever asks, and org B
// reads its own.
export async function versionsOfOrgBUnread(orgs: TwoOrgs) {
  const b = await publishedToSalesInOrgB(orgs);

  for (const ctx of [orgs.orgA.admin.ctx, orgs.orgA.member.ctx, systemCtx(orgs.orgA.id)]) {
    expect(await server.versionsById(ctx, [b.version.id])).toEqual(new Map());
  }
  const own = await server.versionsById(orgs.orgB.member.ctx, [b.version.id]);
  expect([...own.keys()]).toEqual([b.version.id]);
}

// startableVersion's isolation case: org A can't start org B's workflow, admin or member, and
// org B's admin can.
export async function orgBVersionUnstartable(orgs: TwoOrgs) {
  const b = await switchedOnInOrgB(orgs);

  for (const ctx of [orgs.orgA.admin.ctx, orgs.orgA.member.ctx]) {
    await expect(server.startableVersion(ctx, b.workflowId, b.connectionId)).rejects.toThrow(
      NotFoundError,
    );
  }
  expect(
    await server.startableVersion(orgs.orgB.admin.ctx, b.workflowId, b.connectionId),
  ).toMatchObject({ workflowId: b.workflowId, number: 1 });
}

// currentVersionIds' isolation case: org A reads none of org B's current versions, whoever asks,
// and org B reads its own.
export async function currentVersionsOfOrgBUnread(orgs: TwoOrgs) {
  const b = await publishedToSalesInOrgB(orgs);

  for (const ctx of [orgs.orgA.admin.ctx, orgs.orgA.member.ctx, systemCtx(orgs.orgA.id)]) {
    expect(await server.currentVersionIds(ctx, [b.workflowId])).toEqual(new Map());
  }
  expect(await server.currentVersionIds(orgs.orgB.member.ctx, [b.workflowId])).toEqual(
    new Map([[b.workflowId, b.version.id]]),
  );
}
