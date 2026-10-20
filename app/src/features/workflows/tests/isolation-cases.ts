import { expect } from "vitest";
import { defineIsolationCases } from "@/db/testing/isolation";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { connectGmail, connectMailbox } from "@/testing/connect-helpers";
import * as server from "../server";
import { draftSpec, labelSpec } from "./specs";

// Org B gets a published workflow, so every case can check org B is left exactly as it was.
async function seedOrgBWorkflow({ orgA, orgB }: TwoOrgs) {
  await connectGmail(orgA.admin.ctx, orgA.admin.email);
  await connectGmail(orgB.admin.ctx, orgB.admin.email);
  const { id } = await server.saveWorkflow(orgB.admin.ctx, { name: "B", spec: draftSpec() });
  const version = await server.publishWorkflow(orgB.admin.ctx, id);
  return { id, version, before: await server.getWorkflow(orgB.admin.ctx, id) };
}

// Org B's admin has a member workflow switched on for their own connection.
async function switchedOnInOrgB({ orgB }: TwoOrgs) {
  const admin = orgB.admin.ctx;
  const own = await connectMailbox(admin, orgB.admin.email);
  const { id } = await server.saveWorkflow(admin, { name: "B", spec: labelSpec() });
  await server.publishWorkflow(admin, id);
  await server.switchWorkflowOn(admin, id, own.id);
  return { workflowId: id, connectionId: own.id, before: await server.getWorkflow(admin, id) };
}

export const isolationCases = defineIsolationCases(server, {
  saveWorkflow: async (orgs) => {
    const { id, before } = await seedOrgBWorkflow(orgs);
    const ctx = orgs.orgA.admin.ctx;

    await expect(
      server.saveWorkflow(ctx, { workflowId: id, name: "Taken", spec: labelSpec() }),
    ).rejects.toThrow(NotFoundError);
    // The same spec ID is free in org A.
    await server.saveWorkflow(ctx, { name: "A", spec: draftSpec() });

    expect(await server.getWorkflow(orgs.orgB.admin.ctx, id)).toEqual(before);
  },

  listWorkflows: async (orgs) => {
    await seedOrgBWorkflow(orgs);
    const own = await server.saveWorkflow(orgs.orgA.admin.ctx, { name: "A", spec: draftSpec() });

    expect((await server.listWorkflows(orgs.orgA.admin.ctx)).map((w) => w.id)).toEqual([own.id]);
  },

  getWorkflow: async (orgs) => {
    const { id } = await seedOrgBWorkflow(orgs);

    await expect(server.getWorkflow(orgs.orgA.admin.ctx, id)).rejects.toThrow(NotFoundError);
  },

  publishWorkflow: async (orgs) => {
    const { id, before } = await seedOrgBWorkflow(orgs);

    await expect(server.publishWorkflow(orgs.orgA.admin.ctx, id)).rejects.toThrow(NotFoundError);
    expect(await server.getWorkflow(orgs.orgB.admin.ctx, id)).toEqual(before);
  },

  switchWorkflowOn: async (orgs) => {
    const { orgA, orgB } = orgs;
    const b = await switchedOnInOrgB(orgs);
    const ownA = await connectMailbox(orgA.admin.ctx, orgA.admin.email);
    const { id: workflowA } = await server.saveWorkflow(orgA.admin.ctx, {
      name: "A",
      spec: labelSpec(),
    });
    await server.publishWorkflow(orgA.admin.ctx, workflowA);

    await expect(server.switchWorkflowOn(orgA.admin.ctx, b.workflowId, ownA.id)).rejects.toThrow(
      NotFoundError,
    );
    await expect(
      server.switchWorkflowOn(orgA.admin.ctx, workflowA, b.connectionId),
    ).rejects.toThrow(NotFoundError);
    expect(await server.getWorkflow(orgB.admin.ctx, b.workflowId)).toEqual(b.before);
  },

  switchWorkflowOff: async (orgs) => {
    const b = await switchedOnInOrgB(orgs);

    await expect(server.switchWorkflowOff(orgs.orgA.admin.ctx, b.workflowId)).rejects.toThrow(
      NotFoundError,
    );
    expect(await server.getWorkflow(orgs.orgB.admin.ctx, b.workflowId)).toEqual(b.before);
  },

  runnableConnections: async (orgs) => {
    const b = await switchedOnInOrgB(orgs);
    const ownA = await connectMailbox(orgs.orgA.admin.ctx, orgs.orgA.admin.email);
    const { id: workflowA } = await server.saveWorkflow(orgs.orgA.admin.ctx, {
      name: "A",
      spec: labelSpec(),
    });

    await expect(server.runnableConnections(orgs.orgA.admin.ctx, b.workflowId)).rejects.toThrow(
      NotFoundError,
    );
    expect(
      (await server.runnableConnections(orgs.orgA.admin.ctx, workflowA)).map((c) => c.id),
    ).toEqual([ownA.id]);
  },

  listSwitchedOn: async (orgs) => {
    const b = await switchedOnInOrgB(orgs);

    expect(await server.listSwitchedOn(systemCtx(orgs.orgA.id), b.connectionId)).toEqual([]);
  },

  getWorkflowVersion: async (orgs) => {
    const { version } = await seedOrgBWorkflow(orgs);

    await expect(server.getWorkflowVersion(orgs.orgA.admin.ctx, version.id)).rejects.toThrow(
      NotFoundError,
    );
  },
});
