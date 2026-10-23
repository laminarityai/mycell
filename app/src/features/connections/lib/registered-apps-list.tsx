import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { registeredApps } from "../registered-apps";
import type { ConnectionKind, ConnectionSummary } from "../types";
import { ConnectButton } from "./connect-button";

/**
 * The apps our team has registered (ADR-0018), each with the accounts connected to it among
 * `connections` and the button to connect one: the caller's own for `member`, the org's for
 * `org` (admins only).
 */
export function RegisteredAppsList({
  kind,
  connections,
}: {
  kind: ConnectionKind;
  connections: ConnectionSummary[];
}) {
  const label = kind === "member" ? "Your apps" : "Org apps";
  return (
    <Table aria-label={label}>
      <TableHeader>
        <TableRow>
          <TableHead>App</TableHead>
          <TableHead>Connected</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {registeredApps.map((app) => {
          const accounts = connections
            .filter((connection) => connection.source === app.id)
            .map((connection) => connection.accountEmail);
          return (
            <TableRow key={app.id}>
              <TableCell>{app.name}</TableCell>
              <TableCell className="whitespace-normal">
                {accounts.length === 0 ? (
                  <span className="text-muted-foreground">Not connected</span>
                ) : (
                  accounts.join(", ")
                )}
              </TableCell>
              <TableCell className="text-right">
                <ConnectButton
                  app={app.id}
                  kind={kind}
                  label={
                    kind === "member" ? `Connect ${app.name}` : `Connect an org ${app.name} account`
                  }
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
