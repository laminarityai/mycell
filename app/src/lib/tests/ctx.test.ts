import { describe, expect, it } from "vitest";
import {
  isAdmin,
  isSystem,
  requireAdmin,
  requireRole,
  requireSystem,
  systemCtx,
  type Ctx,
} from "../ctx";
import { ForbiddenError } from "../errors";

const admin: Ctx = { orgId: "org", userId: "ada", role: "admin" };
const member: Ctx = { orgId: "org", userId: "bob", role: "member" };
const system = systemCtx("org");

describe("role checks", () => {
  it("lets only an admin past requireAdmin", () => {
    expect(() => {
      requireAdmin(admin);
    }).not.toThrow();
    expect(() => {
      requireAdmin(member);
    }).toThrow(ForbiddenError);
    expect(() => {
      requireAdmin(system);
    }).toThrow(ForbiddenError);
  });

  it("lets only the system ctx past requireSystem", () => {
    expect(() => {
      requireSystem(system);
    }).not.toThrow();
    expect(() => {
      requireSystem(admin);
    }).toThrow(ForbiddenError);
    expect(() => {
      requireSystem(member);
    }).toThrow(ForbiddenError);
  });

  it("lets past requireRole only the actors it names", () => {
    expect(() => {
      requireRole(admin, "admin", "system");
    }).not.toThrow();
    expect(() => {
      requireRole(system, "admin", "system");
    }).not.toThrow();
    expect(() => {
      requireRole(member, "admin", "system");
    }).toThrow(ForbiddenError);
    expect(() => {
      requireRole(member);
    }).toThrow(ForbiddenError);
  });

  it("says whether a ctx is an admin's or the system's", () => {
    expect([admin, member, system].map(isAdmin)).toEqual([true, false, false]);
    expect([admin, member, system].map(isSystem)).toEqual([false, false, true]);
  });
});
