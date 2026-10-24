// listWorkflowBudgets' isolation case, kept apart so isolation-cases.ts stays under the line cap:
// org B's published workflow and its budget never reach org A's admin.
import { expect } from "vitest";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import * as server from "../server";
import { seedOrgBWorkflow } from "./isolation-seeds";

export async function workflowBudgetsStayInOrg(orgs: TwoOrgs): Promise<void> {
  await seedOrgBWorkflow(orgs);

  expect(await server.listWorkflowBudgets(orgs.orgA.admin.ctx)).toEqual([]);
  expect(await server.listWorkflowBudgets(orgs.orgB.admin.ctx)).toHaveLength(1);
}
