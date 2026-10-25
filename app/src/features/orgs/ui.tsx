import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DateTime } from "@/components/date-time";
import { isAdmin, type Ctx, type Role } from "@/lib/ctx";
import { RemovedFromOrgError, WorkspaceAccountRequiredError } from "@/lib/errors";
import { ReAddControl } from "./lib/re-add-control";
import { UserControls } from "./lib/user-controls";
import type { OrgUser, RemovedUser } from "./types";

export { SignInWithGoogleButton, SignOutButton } from "./lib/auth-buttons";

/** The message for a sign-in page's `?error=` code, which Better Auth sets on a rejection. */
export function SignInError({ code }: { code: string }) {
  const message =
    code === WorkspaceAccountRequiredError.code
      ? new WorkspaceAccountRequiredError().message
      : code === RemovedFromOrgError.code
        ? new RemovedFromOrgError().message
        : "Sign-in didn't work. Please try again.";
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

const roleBadges = {
  admin: { label: "Admin", variant: "default" },
  member: { label: "Member", variant: "secondary" },
} as const satisfies Record<Role, { label: string; variant: "default" | "secondary" }>;

/** The org's users. An admin viewer also gets each user's role and removal controls. */
export function OrgUsersTable({ users, viewer }: { users: OrgUser[]; viewer: Ctx }) {
  const canManage = isAdmin(viewer);
  return (
    <Table aria-label="People">
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          {canManage ? (
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((user) => (
          <TableRow key={user.id}>
            <TableCell>{user.name}</TableCell>
            <TableCell>{user.email}</TableCell>
            <TableCell>
              <Badge variant={roleBadges[user.role].variant}>{roleBadges[user.role].label}</Badge>
            </TableCell>
            {canManage ? (
              <TableCell className="text-right">
                <UserControls user={user} />
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * The people admins removed from the org, for an admin: none of them can rejoin by signing in
 * until an admin re-adds them. Nothing when no one is removed.
 */
export function RemovedUsersTable({ removed }: { removed: RemovedUser[] }) {
  if (removed.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Removed people</h2>
      <p className="text-sm text-muted-foreground">
        They can&apos;t rejoin by signing in. Re-add someone to let them join again as a member the
        next time they sign in.
      </p>
      <Table aria-label="Removed people">
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Removed by</TableHead>
            <TableHead>Removed</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {removed.map((person) => (
            <TableRow key={person.id}>
              <TableCell>{person.email}</TableCell>
              <TableCell>{person.removedByName}</TableCell>
              <TableCell>
                <DateTime value={person.removedAt} />
              </TableCell>
              <TableCell className="text-right">
                <ReAddControl removed={person} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
