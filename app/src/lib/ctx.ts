// Who is acting and in which org. Every server-side function takes it first; there is no
// hidden request state.
import { z } from "zod";

// Better Auth stores the role as free text; parse it with this on the way out of the database.
export const roleSchema = z.enum(["admin", "member"]);
export type Role = z.infer<typeof roleSchema>;

export type Ctx = {
  readonly orgId: string;
  readonly userId: string;
  readonly role: Role;
};
