import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Role } from "@/lib/ctx";
import { WorkspaceAccountRequiredError } from "@/lib/errors";
import type { OrgUser } from "./types";

export { SignInWithGoogleButton, SignOutButton } from "./lib/auth-buttons";

/** The message for a sign-in page's `?error=` code, which Better Auth sets on a rejection. */
export function SignInError({ code }: { code: string }) {
  const message =
    code === WorkspaceAccountRequiredError.code
      ? new WorkspaceAccountRequiredError().message
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

export function OrgUsersTable({ users }: { users: OrgUser[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
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
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
