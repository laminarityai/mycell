// Isolation cases for pausing a workflow after its runs failed (M8), spread into workflows'
// isolationCases: org A can't read when org B's count starts, pause it, resume it or see it
// among the paused workflows its alerts name.
import { expect } from "vitest";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import * as server from "../server";
import { switchedOnInOrgB } from "./isolation-seeds";

const RUNS = ["run-1", "run-2", "run-3"];

export const failurePauseIsolationCases = {
  failureStreakStart: async (orgs: TwoOrgs) => {
    const b = await switchedOnInOrgB(orgs);

    await expect(server.failureStreakStart(systemCtx(orgs.orgA.id), b.workflowId)).rejects.toThrow(
      NotFoundError,
    );
  },

  pauseForFailures: async (orgs: TwoOrgs) => {
    const b = await switchedOnInOrgB(orgs);

    await server.pauseForFailures(systemCtx(orgs.orgA.id), b.workflowId, RUNS);

    expect(await server.getWorkflow(orgs.orgB.admin.ctx, b.workflowId)).toEqual(b.before);
    expect(await server.listStartable(systemCtx(orgs.orgB.id), b.connectionId)).toHaveLength(1);
  },

  resumeWorkflow: async (orgs: TwoOrgs) => {
    const b = await switchedOnInOrgB(orgs);
    await server.pauseForFailures(systemCtx(orgs.orgB.id), b.workflowId, RUNS);

    await expect(server.resumeWorkflow(orgs.orgA.admin.ctx, b.workflowId)).rejects.toThrow(
      NotFoundError,
    );
    expect(await server.listStartable(systemCtx(orgs.orgB.id), b.connectionId)).toEqual([]);
  },

  listPausedWorkflows: async (orgs: TwoOrgs) => {
    const b = await switchedOnInOrgB(orgs);
    await server.pauseForFailures(systemCtx(orgs.orgB.id), b.workflowId, RUNS);

    expect(await server.listPausedWorkflows(orgs.orgA.admin.ctx)).toEqual([]);
    expect(await server.listPausedWorkflows(orgs.orgB.admin.ctx)).toEqual([
      expect.objectContaining({ id: b.workflowId }),
    ]);
  },
};
