// What the isolation cases (isolation-cases.ts) seed in org B, for each case to check org A
// can't reach it.
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { listTags } from "@/features/tags/server";
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

// Org B's admin has a member workflow switched on for their own connection.
export async function switchedOnInOrgB({ orgB }: TwoOrgs) {
  const admin = orgB.admin.ctx;
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
