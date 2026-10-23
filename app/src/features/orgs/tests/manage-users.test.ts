import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { hasSession, seedSession } from "@/db/testing/seed-session";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { listUsers, removeUser, setRole } from "../server";

beforeEach(resetDatabase);

const roles = async (ctx: Parameters<typeof listUsers>[0]) =>
  Object.fromEntries((await listUsers(ctx)).map((u) => [u.id, u.role]));

describe("setRole", () => {
  it("lets an admin promote a member to admin", async () => {
    const { orgA } = await seedTwoOrgs();

    await setRole(orgA.admin.ctx, orgA.member.id, "admin");

    expect(await roles(orgA.admin.ctx)).toEqual({
      [orgA.admin.id]: "admin",
      [orgA.member.id]: "admin",
    });
  });

  it("refuses a member", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(setRole(orgA.member.ctx, orgA.member.id, "admin")).rejects.toThrow(ForbiddenError);
    expect(await roles(orgA.admin.ctx)).toEqual({
      [orgA.admin.id]: "admin",
      [orgA.member.id]: "member",
    });
  });

  it("treats a user from another org as if they don't exist", async () => {
    const { orgA, orgB } = await seedTwoOrgs();

    await expect(setRole(orgA.admin.ctx, orgB.member.id, "admin")).rejects.toThrow(NotFoundError);
    expect(await roles(orgB.admin.ctx)).toEqual({
      [orgB.admin.id]: "admin",
      [orgB.member.id]: "member",
    });
  });

  it("lets an admin demote another admin", async () => {
    const { orgA } = await seedTwoOrgs();
    await setRole(orgA.admin.ctx, orgA.member.id, "admin");

    await setRole(orgA.admin.ctx, orgA.member.id, "member");

    expect(await roles(orgA.admin.ctx)).toEqual({
      [orgA.admin.id]: "admin",
      [orgA.member.id]: "member",
    });
  });

  it("refuses to demote the org's last admin", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(setRole(orgA.admin.ctx, orgA.admin.id, "member")).rejects.toThrow(ConflictError);
    expect(await roles(orgA.admin.ctx)).toEqual({
      [orgA.admin.id]: "admin",
      [orgA.member.id]: "member",
    });
  });
});

describe("removeUser", () => {
  it("takes the user out of the org and ends their sessions", async () => {
    const { orgA } = await seedTwoOrgs();
    await seedSession(orgA.member.id);
    await seedSession(orgA.admin.id);

    await removeUser(orgA.admin.ctx, orgA.member.id);

    expect(await roles(orgA.admin.ctx)).toEqual({ [orgA.admin.id]: "admin" });
    expect(await hasSession(orgA.member.id)).toBe(false);
    expect(await hasSession(orgA.admin.id)).toBe(true);
  });

  it("refuses a member", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(removeUser(orgA.member.ctx, orgA.admin.id)).rejects.toThrow(ForbiddenError);
    expect(Object.keys(await roles(orgA.admin.ctx))).toHaveLength(2);
  });

  it("treats a user from another org as if they don't exist", async () => {
    const { orgA, orgB } = await seedTwoOrgs();
    await seedSession(orgB.member.id);

    await expect(removeUser(orgA.admin.ctx, orgB.member.id)).rejects.toThrow(NotFoundError);
    expect(Object.keys(await roles(orgB.admin.ctx))).toHaveLength(2);
    expect(await hasSession(orgB.member.id)).toBe(true);
  });

  // removeUserAction relies on it: tried again after deleting their connections failed, it
  // finds the user gone and goes on to delete their connections.
  it("treats a user already removed as if they don't exist", async () => {
    const { orgA } = await seedTwoOrgs();
    await removeUser(orgA.admin.ctx, orgA.member.id);

    await expect(removeUser(orgA.admin.ctx, orgA.member.id)).rejects.toThrow(NotFoundError);
    expect(await roles(orgA.admin.ctx)).toEqual({ [orgA.admin.id]: "admin" });
  });

  it("refuses to remove the org's last admin", async () => {
    const { orgA } = await seedTwoOrgs();

    await expect(removeUser(orgA.admin.ctx, orgA.admin.id)).rejects.toThrow(ConflictError);
    expect(await roles(orgA.admin.ctx)).toEqual({
      [orgA.admin.id]: "admin",
      [orgA.member.id]: "member",
    });
  });
});
