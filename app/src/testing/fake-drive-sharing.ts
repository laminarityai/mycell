// A fake Drive file's sharing list: the entries a test shares a file with, and the permissions
// resources Drive gives for them.
import { randomUUID } from "node:crypto";

/** One entry on a file's sharing list, besides its owners: a person, a group, a domain or anyone. */
export type FakeShareInput =
  | { type: "user" | "group"; emailAddress: string; role?: ShareRole }
  | { type: "domain"; domain: string; role?: ShareRole }
  | { type: "anyone"; role?: ShareRole };

type ShareRole = "writer" | "commenter" | "reader";

/** A permissions resource, as Drive gives it. */
export type DrivePermission = {
  kind: "drive#permission";
  id: string;
  type: "user" | "group" | "domain" | "anyone";
  role: "owner" | ShareRole;
  emailAddress?: string;
  domain?: string;
  allowFileDiscovery?: boolean;
  deleted?: boolean;
};

/** The permissions resource for one entry on a sharing list, with `role`. */
export function permission(share: FakeShareInput, role: DrivePermission["role"]): DrivePermission {
  const id = randomUUID().replaceAll("-", "").slice(0, 20);
  const base = { kind: "drive#permission" as const, id, role };
  switch (share.type) {
    case "user":
    case "group":
      return { ...base, type: share.type, emailAddress: share.emailAddress, deleted: false };
    case "domain":
      return { ...base, type: "domain", domain: share.domain, allowFileDiscovery: true };
    case "anyone":
      return { ...base, type: "anyone", allowFileDiscovery: false };
  }
}
