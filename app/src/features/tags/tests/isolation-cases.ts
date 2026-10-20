import { expect } from "vitest";
import { defineIsolationCases } from "@/db/testing/isolation";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { NotFoundError } from "@/lib/errors";
import * as server from "../server";

// Org B gets a tag on its member, so every case can check org B is left exactly as it was.
async function seedOrgBTag({ orgB }: TwoOrgs) {
  const tag = await server.createTag(orgB.admin.ctx, "sales");
  await server.assignTag(orgB.admin.ctx, tag.id, orgB.member.id);
  return { tag, before: await server.listTags(orgB.admin.ctx) };
}

export const isolationCases = defineIsolationCases(server, {
  createTag: async (orgs) => {
    const { before } = await seedOrgBTag(orgs);

    await server.createTag(orgs.orgA.admin.ctx, "sales");

    expect(await server.listTags(orgs.orgB.admin.ctx)).toEqual(before);
  },

  listTags: async (orgs) => {
    await seedOrgBTag(orgs);
    const own = await server.createTag(orgs.orgA.admin.ctx, "support");

    expect(await server.listTags(orgs.orgA.admin.ctx)).toEqual([own]);
  },

  listMyTags: async (orgs) => {
    await seedOrgBTag(orgs);

    expect(await server.listMyTags(orgs.orgA.member.ctx)).toEqual([]);
  },

  renameTag: async (orgs) => {
    const { tag, before } = await seedOrgBTag(orgs);

    await expect(server.renameTag(orgs.orgA.admin.ctx, tag.id, "ops")).rejects.toThrow(
      NotFoundError,
    );
    expect(await server.listTags(orgs.orgB.admin.ctx)).toEqual(before);
  },

  deleteTag: async (orgs) => {
    const { tag, before } = await seedOrgBTag(orgs);

    await expect(server.deleteTag(orgs.orgA.admin.ctx, tag.id)).rejects.toThrow(NotFoundError);
    expect(await server.listTags(orgs.orgB.admin.ctx)).toEqual(before);
  },

  assignTag: async (orgs) => {
    const { tag, before } = await seedOrgBTag(orgs);
    const orgATag = await server.createTag(orgs.orgA.admin.ctx, "support");

    await expect(
      server.assignTag(orgs.orgA.admin.ctx, tag.id, orgs.orgA.member.id),
    ).rejects.toThrow(NotFoundError);
    await expect(
      server.assignTag(orgs.orgA.admin.ctx, orgATag.id, orgs.orgB.admin.id),
    ).rejects.toThrow(NotFoundError);
    expect(await server.listTags(orgs.orgB.admin.ctx)).toEqual(before);
    expect((await server.listTags(orgs.orgA.admin.ctx))[0]?.userIds).toEqual([]);
  },

  unassignTag: async (orgs) => {
    const { tag, before } = await seedOrgBTag(orgs);

    await expect(
      server.unassignTag(orgs.orgA.admin.ctx, tag.id, orgs.orgB.member.id),
    ).rejects.toThrow(NotFoundError);
    expect(await server.listTags(orgs.orgB.admin.ctx)).toEqual(before);
  },
});
