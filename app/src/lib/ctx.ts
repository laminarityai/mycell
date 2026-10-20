// Who is acting and in which org. Every server-side function takes it first; there is no
// hidden request state.
import { z } from "zod";

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
