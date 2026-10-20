import { expect } from "vitest";
import { NotFoundError } from "@/lib/errors";
import { defineIsolationCases, notTenantScoped } from "@/db/testing/isolation";
import { seedUserWithoutOrg } from "@/db/testing/seed-user";
import * as server from "../server";

export const isolationCases = defineIsolationCases(server, {
  getCtx: notTenantScoped(
    "takes no org or ID: it reads the session's own membership, so a caller can't name another org",
  ),
  handleAuthRequest: notTenantScoped(
    "Better Auth's sign-in endpoints; the organization plugin's endpoints are switched off",
  ),

  signIn: async ({ orgA, orgB }) => {
    const orgBUsers = await server.listUsers(orgB.admin.ctx);
    const newcomer = await seedUserWithoutOrg(`newcomer@${orgA.workspaceDomain}`);

    const ctx = await server.signIn({ userId: newcomer.id, hd: orgA.workspaceDomain });

    expect(ctx).toEqual({ orgId: orgA.id, userId: newcomer.id, role: "member" });
    expect(await server.listUsers(orgB.admin.ctx)).toEqual(orgBUsers);
  },

  findCtx: async ({ orgA, orgB }) => {
    expect(await server.findCtx(orgA.member.id)).toEqual(orgA.member.ctx);
    expect(await server.findCtx(orgB.admin.id)).toEqual(orgB.admin.ctx);
  },

  listUsers: async ({ orgA }) => {
    const users = await server.listUsers(orgA.member.ctx);

    expect(users.map((u) => u.id).sort()).toEqual([orgA.admin.id, orgA.member.id].sort());
  },

  getWorkspaceDomain: async ({ orgA, orgB }) => {
    expect(await server.getWorkspaceDomain(orgA.member.ctx)).toBe(orgA.workspaceDomain);
    expect(await server.getWorkspaceDomain(orgB.admin.ctx)).toBe(orgB.workspaceDomain);
  },

  setRole: async ({ orgA, orgB }) => {
    const orgBUsers = await server.listUsers(orgB.admin.ctx);

    await expect(server.setRole(orgA.admin.ctx, orgB.member.id, "admin")).rejects.toThrow(
      NotFoundError,
    );
    expect(await server.listUsers(orgB.admin.ctx)).toEqual(orgBUsers);
  },

  removeUser: async ({ orgA, orgB }) => {
    const orgBUsers = await server.listUsers(orgB.admin.ctx);

    await expect(server.removeUser(orgA.admin.ctx, orgB.member.id)).rejects.toThrow(NotFoundError);
    expect(await server.listUsers(orgB.admin.ctx)).toEqual(orgBUsers);
  },
});
