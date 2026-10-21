import { expect } from "vitest";
import { defineIsolationCases } from "@/db/testing/isolation";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { connectGmail, connectMailbox } from "@/testing/connect-helpers";
import { listTags, renameTag, unassignTag } from "@/features/tags/server";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
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

// Org B publishes a workflow to its own `sales` tag, which its member has.
async function publishedToSalesInOrgB({ orgB }: TwoOrgs) {
  await connectGmail(orgB.admin.ctx, orgB.admin.email);
  await tagUsers(orgB.admin.ctx, "sales", [orgB.member]);
  return publishTo(orgB.admin.ctx, "B", labelSpec(), ["sales"]);
}

// Org B's tag IDs.
async function orgBTags({ orgB }: TwoOrgs): Promise<string[]> {
  return (await listTags(orgB.admin.ctx)).map((tag) => tag.id);
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

  previewPublish: async (orgs) => {
    const { id } = await seedOrgBWorkflow(orgs);

    await expect(
      server.previewPublish(orgs.orgA.admin.ctx, id, labelSpec({ id: "pricing-replies" })),
    ).rejects.toThrow(NotFoundError);
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

  listStartable: async (orgs) => {
    const b = await switchedOnInOrgB(orgs);

    expect(await server.listStartable(systemCtx(orgs.orgA.id), b.connectionId)).toEqual([]);
    expect(await server.listStartable(systemCtx(orgs.orgB.id), b.connectionId)).toHaveLength(1);
  },

  enable: async (orgs) => {
    const { orgA, orgB } = orgs;
    const b = await publishedToSalesInOrgB(orgs);
    await connectMailbox(orgA.member.ctx, orgA.member.email);
    await tagUsers(orgA.admin.ctx, "sales", [orgA.member]);

    for (const user of [orgA.admin, orgA.member]) {
      await expect(server.enable(user.ctx, b.workflowId)).rejects.toThrow(NotFoundError);
    }
    expect(await server.listEnablements(orgB.admin.ctx, b.workflowId)).toEqual([]);
  },

  disable: async (orgs) => {
    const { orgA, orgB } = orgs;
    const b = await publishedToSalesInOrgB(orgs);
    await connectMailbox(orgB.member.ctx, orgB.member.email);
    await server.enable(orgB.member.ctx, b.workflowId);
    const before = await server.listEnablements(orgB.admin.ctx, b.workflowId);

    await expect(server.disable(orgA.member.ctx, b.workflowId)).rejects.toThrow(NotFoundError);
    expect(await server.listEnablements(orgB.admin.ctx, b.workflowId)).toEqual(before);
  },

  listEnablements: async (orgs) => {
    const { orgA, orgB } = orgs;
    const b = await publishedToSalesInOrgB(orgs);
    await connectMailbox(orgB.member.ctx, orgB.member.email);
    await server.enable(orgB.member.ctx, b.workflowId);

    await expect(server.listEnablements(orgA.admin.ctx, b.workflowId)).rejects.toThrow(
      NotFoundError,
    );
    expect(await server.listEnablements(orgB.admin.ctx, b.workflowId)).toHaveLength(1);
  },

  workflowNames: async (orgs) => {
    const b = await seedOrgBWorkflow(orgs);
    const own = await server.saveWorkflow(orgs.orgA.admin.ctx, { name: "A", spec: draftSpec() });

    for (const ctx of [orgs.orgA.admin.ctx, orgs.orgA.member.ctx]) {
      const names = await server.workflowNames(ctx, [b.id, own.id]);
      expect([...names]).toEqual([[own.id, "A"]]);
    }
  },

  currentVersionIds: async (orgs) => {
    const b = await publishedToSalesInOrgB(orgs);

    for (const ctx of [orgs.orgA.admin.ctx, orgs.orgA.member.ctx, systemCtx(orgs.orgA.id)]) {
      expect(await server.currentVersionIds(ctx, [b.workflowId])).toEqual(new Map());
    }
    expect(await server.currentVersionIds(orgs.orgB.member.ctx, [b.workflowId])).toEqual(
      new Map([[b.workflowId, b.version.id]]),
    );
  },

  reviewSharing: async (orgs) => {
    const b = await publishedToSalesInOrgB(orgs);
    await tagUsers(orgs.orgA.admin.ctx, "sales", [orgs.orgA.member]);

    for (const ctx of [orgs.orgA.admin.ctx, orgs.orgA.member.ctx, systemCtx(orgs.orgA.id)]) {
      expect(await server.reviewSharing(ctx, [b.workflowId])).toEqual(new Map());
    }
    expect(await server.reviewSharing(orgs.orgB.member.ctx, [b.workflowId])).toEqual(
      new Map([[b.workflowId, { seen: true, handOff: false }]]),
    );
  },

  checkWorkflowSpec: async (orgs) => {
    // Only org B has a Gmail connection: org A's check can't count it.
    await connectGmail(orgs.orgB.admin.ctx, orgs.orgB.admin.email);

    const checked = await server.checkWorkflowSpec(orgs.orgA.admin.ctx, draftSpec());

    expect(checked.ok ? [] : checked.issues.map((issue) => issue.path)).toEqual([["credentials"]]);
    expect((await server.checkWorkflowSpec(orgs.orgB.admin.ctx, draftSpec())).ok).toBe(true);
  },

  listVisibleWorkflows: async (orgs) => {
    const { orgA, orgB } = orgs;
    const b = await publishedToSalesInOrgB(orgs);
    // Org A has a `sales` tag on its member too, and publishes a workflow to it.
    await connectGmail(orgA.admin.ctx, orgA.admin.email);
    await tagUsers(orgA.admin.ctx, "sales", [orgA.member]);
    const a = await publishTo(orgA.admin.ctx, "A", labelSpec(), ["sales"]);

    for (const user of [orgA.admin, orgA.member]) {
      expect((await server.listVisibleWorkflows(user.ctx)).map((w) => w.id)).toEqual([
        a.workflowId,
      ]);
    }
    // Org B's admin sees its reach counted from org B's tags alone.
    expect(
      (await server.listVisibleWorkflows(orgB.admin.ctx)).map((w) => [w.id, w.audience?.reach]),
    ).toEqual([[b.workflowId, 1]]);
  },

  getVisibleWorkflow: async (orgs) => {
    const { orgA } = orgs;
    const b = await publishedToSalesInOrgB(orgs);
    await tagUsers(orgA.admin.ctx, "sales", [orgA.member]);

    for (const user of [orgA.admin, orgA.member]) {
      await expect(server.getVisibleWorkflow(user.ctx, b.workflowId)).rejects.toThrow(
        NotFoundError,
      );
    }
  },

  archiveWorkflow: async (orgs) => {
    const { orgA, orgB } = orgs;
    const b = await publishedToSalesInOrgB(orgs);

    await expect(server.archiveWorkflow(orgA.admin.ctx, b.workflowId)).rejects.toThrow(
      NotFoundError,
    );
    expect((await server.listVisibleWorkflows(orgB.member.ctx)).map((w) => w.id)).toEqual([
      b.workflowId,
    ]);
  },

  restoreWorkflow: async (orgs) => {
    const { orgA, orgB } = orgs;
    const b = await publishedToSalesInOrgB(orgs);
    await server.archiveWorkflow(orgB.admin.ctx, b.workflowId);

    await expect(server.restoreWorkflow(orgA.admin.ctx, b.workflowId)).rejects.toThrow(
      NotFoundError,
    );
    expect(await server.listVisibleWorkflows(orgB.member.ctx)).toEqual([]);
  },

  removeInvisibleEnablements: async (orgs) => {
    const { orgA, orgB } = orgs;
    const b = await publishedToSalesInOrgB(orgs);
    await connectMailbox(orgB.member.ctx, orgB.member.email);
    await server.enable(orgB.member.ctx, b.workflowId);
    // Org B's member loses `sales`, and no cleanup has run in org B yet.
    for (const tagId of await orgBTags(orgs)) {
      await unassignTag(orgB.admin.ctx, tagId, orgB.member.id);
    }

    for (const ctx of [systemCtx(orgA.id), orgA.admin.ctx]) {
      await server.removeInvisibleEnablements(ctx, {});
      await server.removeInvisibleEnablements(ctx, { userId: orgB.member.id });
      await server.removeInvisibleEnablements(ctx, { workflowId: b.workflowId });
    }
    expect(await server.listEnablements(orgB.admin.ctx, b.workflowId)).toHaveLength(1);
  },

  followTagRename: async (orgs) => {
    const { orgA, orgB } = orgs;
    const b = await publishedToSalesInOrgB(orgs);
    const [tagId = ""] = await orgBTags(orgs);
    await renameTag(orgB.admin.ctx, tagId, "sales-team");
    const before = await server.getWorkflow(orgB.admin.ctx, b.workflowId);

    // Org A's admin and system ctx can't follow org B's tag, so org B's working spec stays.
    for (const ctx of [systemCtx(orgA.id), orgA.admin.ctx]) {
      expect(await server.followTagRename(ctx, { tagId, from: "sales" })).toBe(0);
    }
    expect(await server.getWorkflow(orgB.admin.ctx, b.workflowId)).toEqual(before);
  },

  getWorkflowVersion: async (orgs) => {
    const { version } = await seedOrgBWorkflow(orgs);

    await expect(server.getWorkflowVersion(orgs.orgA.admin.ctx, version.id)).rejects.toThrow(
      NotFoundError,
    );
  },
});
