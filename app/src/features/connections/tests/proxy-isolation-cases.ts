// Isolation cases for reaching an app through a connection (Nango's proxy, source clients),
// spread into connections' isolationCases.
import { expect } from "vitest";
import { z } from "zod";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { NotFoundError } from "@/lib/errors";
import * as server from "../server";
import { orgBIds, seedOrgBConnection } from "./isolation-seed";

export const proxyIsolationCases = {
  proxyGet: async (orgs: TwoOrgs) => {
    const { before, memberBefore } = await seedOrgBConnection(orgs);
    const profile = z.object({ emailAddress: z.string() });

    for (const id of orgBIds(before, memberBefore)) {
      await expect(
        server.proxyGet(orgs.orgA.admin.ctx, id, "/gmail/v1/users/me/profile", profile),
      ).rejects.toThrow(NotFoundError);
    }
    expect(await server.listConnections(orgs.orgB.admin.ctx)).toEqual(before);
  },

  sourceClient: async (orgs: TwoOrgs) => {
    const { before, memberBefore } = await seedOrgBConnection(orgs);

    for (const id of orgBIds(before, memberBefore)) {
      await expect(server.sourceClient(orgs.orgA.admin.ctx, id)).rejects.toThrow(NotFoundError);
    }
    expect(await server.listConnections(orgs.orgB.admin.ctx)).toEqual(before);
  },

  proxyGetText: async (orgs: TwoOrgs) => {
    const { before, memberBefore } = await seedOrgBConnection(orgs);

    for (const id of orgBIds(before, memberBefore)) {
      await expect(
        server.proxyGetText(
          orgs.orgA.admin.ctx,
          id,
          "/drive/v3/files/f-1/export?mimeType=text%2Fplain",
        ),
      ).rejects.toThrow(NotFoundError);
    }
    expect(await server.listConnections(orgs.orgB.admin.ctx)).toEqual(before);
  },

  proxyPost: async (orgs: TwoOrgs) => {
    const { before, memberBefore } = await seedOrgBConnection(orgs);
    const label = z.object({ id: z.string() });

    for (const id of orgBIds(before, memberBefore)) {
      await expect(
        server.proxyPost(
          orgs.orgA.admin.ctx,
          id,
          "/gmail/v1/users/me/labels",
          { name: "X" },
          label,
        ),
      ).rejects.toThrow(NotFoundError);
    }
    expect(await server.listConnections(orgs.orgB.admin.ctx)).toEqual(before);
  },

  proxyPut: async (orgs: TwoOrgs) => {
    const { before, memberBefore } = await seedOrgBConnection(orgs);
    const draft = z.object({ id: z.string() });

    for (const id of orgBIds(before, memberBefore)) {
      await expect(
        server.proxyPut(orgs.orgA.admin.ctx, id, "/gmail/v1/users/me/drafts/r-1", {}, draft),
      ).rejects.toThrow(NotFoundError);
    }
    expect(await server.listConnections(orgs.orgB.admin.ctx)).toEqual(before);
  },

  proxyPatch: async (orgs: TwoOrgs) => {
    const { before, memberBefore } = await seedOrgBConnection(orgs);
    const message = z.object({ id: z.string() });

    for (const id of orgBIds(before, memberBefore)) {
      await expect(
        server.proxyPatch(orgs.orgA.admin.ctx, id, "/gmail/v1/users/me/drafts/r-1", {}, message),
      ).rejects.toThrow(NotFoundError);
    }
    expect(await server.listConnections(orgs.orgB.admin.ctx)).toEqual(before);
  },

  proxyDelete: async (orgs: TwoOrgs) => {
    const { before, memberBefore } = await seedOrgBConnection(orgs);

    for (const id of orgBIds(before, memberBefore)) {
      await expect(
        server.proxyDelete(orgs.orgA.admin.ctx, id, "/gmail/v1/users/me/drafts/r-1"),
      ).rejects.toThrow(NotFoundError);
    }
    expect(await server.listConnections(orgs.orgB.admin.ctx)).toEqual(before);
  },
};
