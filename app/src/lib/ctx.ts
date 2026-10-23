// Who is acting and in which org. Every server-side function takes it first; there is no
// hidden request state.
import { z } from "zod";
import { ForbiddenError } from "./errors";

// Better Auth stores the role as free text; parse it with this on the way out of the database.
export const roleSchema = z.enum(["admin", "member"]);
export type Role = z.infer<typeof roleSchema>;

/**
 * `system` is no user: it's how scheduled jobs (polling, reconciliation) act inside one org
 * (ADR-0009). It may read and maintain the org's connections, and passes no admin check.
 */
export const actorSchema = z.enum([...roleSchema.options, "system"]);
export type Actor = z.infer<typeof actorSchema>;

export type Ctx = {
  readonly orgId: string;
  readonly userId: string;
  readonly role: Actor;
};

export const SYSTEM_USER_ID = "system";

/** The ctx a scheduled job acts as inside one org. Only jobs build it. */
export function systemCtx(orgId: string): Ctx {
  return { orgId, userId: SYSTEM_USER_ID, role: "system" };
}

// Every role check goes through these: a lint rule bans comparing `ctx.role` anywhere else.

/** The admin check every admin-only server function starts with: anyone else is ForbiddenError. */
export function requireAdmin(ctx: Ctx): void {
  requireRole(ctx, "admin");
}

/** The check a function only jobs call starts with: anyone but `system` is ForbiddenError. */
export function requireSystem(ctx: Ctx): void {
  requireRole(ctx, "system");
}

/** ForbiddenError unless the ctx acts as one of `actors`. */
export function requireRole(ctx: Ctx, ...actors: Actor[]): void {
  if (!actors.includes(ctx.role)) throw new ForbiddenError();
}

/** Whether the ctx is an admin's. */
export function isAdmin(ctx: Ctx): boolean {
  return ctx.role === "admin";
}

/** Whether the ctx is a scheduled job's (`system`), not a person's. */
export function isSystem(ctx: Ctx): boolean {
  return ctx.role === "system";
}
