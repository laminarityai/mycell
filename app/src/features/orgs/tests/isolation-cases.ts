import { expect } from "vitest";
import { NotFoundError } from "@/lib/errors";
import { defineIsolationCases, notTenantScoped } from "@/db/testing/isolation";
import { seedUserWithoutOrg } from "@/db/testing/seed-user";
import { seedUser } from "@/db/testing/two-org-fixture";
import * as server from "../server";

export const isolationCases = defineIsolationCases(server, {
  getCtx: notTenantScoped(
    "takes no org or ID: it reads the session's own membership, so a caller can't name another org",
  ),
  findSessionCtx: notTenantScoped(
    "getCtx without the redirect: it reads the session's own membership, and takes no org or ID",
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

  listOrgIds: notTenantScoped(
    "lists every org's ID for scheduled jobs, which then act inside one org at a time",
  ),

  // Cross-org by design: a Gmail notification names only an address. What it must keep
  // straight is that each address finds its own org, and only an org ID comes back.
  findOrgIdForAddress: async ({ orgA, orgB }) => {
    const pat = await seedUser(orgB.id, "pat@secondary-b.test", "member");

    expect(await server.findOrgIdForAddress(orgA.member.email)).toBe(orgA.id);
    expect(await server.findOrgIdForAddress(orgB.admin.email.toUpperCase())).toBe(orgB.id);
    expect(await server.findOrgIdForAddress(pat.email)).toBe(orgB.id);
    expect(await server.findOrgIdForAddress(`support@${orgA.workspaceDomain}`)).toBe(orgA.id);
    expect(await server.findOrgIdForAddress(`support@${orgB.workspaceDomain}`)).toBe(orgB.id);
    expect(await server.findOrgIdForAddress("someone@secondary-b.test")).toBeUndefined();
    expect(await server.findOrgIdForAddress("someone@elsewhere.test")).toBeUndefined();
  },

  findCtx: async ({ orgA, orgB }) => {
    expect(await server.findCtx(orgA.member.id)).toEqual(orgA.member.ctx);
    expect(await server.findCtx(orgB.admin.id)).toEqual(orgB.admin.ctx);
  },

  listUsers: async ({ orgA }) => {
    const users = await server.listUsers(orgA.member.ctx);

    expect(users.map((u) => u.id).sort()).toEqual([orgA.admin.id, orgA.member.id].sort());
  },

  findUser: async ({ orgA, orgB }) => {
    expect(await server.findUser(orgA.member.ctx, orgB.admin.id)).toBeNull();
    expect(await server.findUser(orgA.member.ctx, orgA.admin.id)).toEqual(
      expect.objectContaining({ id: orgA.admin.id, role: "admin" }),
    );
  },

  findUsersByEmail: async ({ orgA, orgB }) => {
    const found = await server.findUsersByEmail(orgA.member.ctx, [
      orgB.admin.email,
      orgA.admin.email.toUpperCase(),
    ]);

    expect(found.map((user) => user.id)).toEqual([orgA.admin.id]);
  },

  userCtx: async ({ orgA, orgB }) => {
    expect(await server.userCtx(orgA.member.ctx, orgB.admin.id)).toBeNull();
    expect(await server.userCtx(orgA.member.ctx, orgA.admin.id)).toEqual(orgA.admin.ctx);
  },

  userNames: async ({ orgA, orgB }) => {
    const nameOf = await server.userNames(orgA.member.ctx);

    expect(nameOf(orgA.admin.id)).toBe(orgA.admin.email);
    expect(nameOf(orgB.admin.id)).toBe("someone no longer in the org");
  },

  getWorkspaceDomain: async ({ orgA, orgB }) => {
    expect(await server.getWorkspaceDomain(orgA.member.ctx)).toBe(orgA.workspaceDomain);
    expect(await server.getWorkspaceDomain(orgB.admin.ctx)).toBe(orgB.workspaceDomain);
  },

  getOrgSettings: async ({ orgA, orgB }) => {
    expect(await server.getOrgSettings(orgA.member.ctx)).toEqual({
      name: "Org A",
      workspaceDomain: orgA.workspaceDomain,
    });
    expect(await server.getOrgSettings(orgB.admin.ctx)).toEqual({
      name: "Org B",
      workspaceDomain: orgB.workspaceDomain,
    });
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
