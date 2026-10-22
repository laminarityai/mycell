import { expect } from "vitest";
import { defineIsolationCases } from "@/db/testing/isolation";
import { systemCtx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import * as server from "../server";

export const isolationCases = defineIsolationCases(server, {
  encryptForOrg: async ({ orgA, orgB }) => {
    const encrypted = await server.encryptForOrg(orgA.member.ctx, "Org A's text");

    await expect(server.decryptForOrg(orgB.member.ctx, encrypted)).rejects.toThrow(NotFoundError);
    expect(await server.decryptForOrg(orgA.admin.ctx, encrypted)).toBe("Org A's text");
  },

  decryptForOrg: async ({ orgA, orgB }) => {
    const forB = await server.encryptForOrg(orgB.member.ctx, "Org B's text");

    await expect(server.decryptForOrg(orgA.admin.ctx, forB)).rejects.toThrow(NotFoundError);
  },

  hashForOrg: async ({ orgA, orgB }) => {
    const forA = await server.hashForOrg(orgA.admin.ctx, "sam@client.example");

    expect(await server.hashForOrg(orgB.admin.ctx, "sam@client.example")).not.toBe(forA);
    expect(await server.hashForOrg(orgA.member.ctx, "sam@client.example")).toBe(forA);
  },

  destroyOrgKey: async ({ orgA, orgB }) => {
    const forA = await server.encryptForOrg(orgA.member.ctx, "Org A's text");
    const forB = await server.encryptForOrg(orgB.member.ctx, "Org B's text");

    await server.destroyOrgKey(systemCtx(orgA.id));

    expect(await server.decryptForOrg(orgB.member.ctx, forB)).toBe("Org B's text");
    await expect(server.decryptForOrg(orgA.member.ctx, forA)).rejects.toThrow(NotFoundError);
  },
});
