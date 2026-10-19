// Who is acting and in which org. Every server-side function takes it first; there is no
// hidden request state.
export type Role = "admin" | "member";

export type Ctx = {
  readonly orgId: string;
  readonly userId: string;
  readonly role: Role;
};
