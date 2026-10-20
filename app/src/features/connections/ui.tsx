import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminConnections } from "./lib/admin-connections";
import { ConnectButton } from "./lib/connect-button";
import { ConnectionControls, ReauthNotices } from "./lib/connection-controls";
import { attemptTarget, SOURCE_NAMES } from "./lib/source-names";
import { LastPolled, StatusBadge } from "./lib/status-badge";
import type { ConnectionsListing } from "./types";

/**
 * The caller's connections, their unfinished connect attempts, and the buttons to connect.
 * Admins also get the org's connections and the controls to make one.
 */
export function ConnectionsPanel({
  listing,
  isAdmin,
}: {
  listing: ConnectionsListing;
  isAdmin: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <ConnectButton source="gmail" kind="member" label="Connect Gmail" />
        <ConnectButton source="drive" kind="member" label="Connect Google Drive" />
      </div>
      {listing.attempts.map((attempt) => (
        <p
          key={attempt.id}
          className={
            attempt.status === "refused"
              ? "text-sm text-destructive"
              : "text-sm text-muted-foreground"
          }
        >
          {attempt.status === "pending"
            ? `Connecting ${attemptTarget(attempt)}…`
            : `Couldn't connect ${attemptTarget(attempt)}: ${attempt.refusal ?? "it was refused."}`}
        </p>
      ))}
      <ReauthNotices connections={listing.connections} />
      {listing.connections.length === 0 ? (
        <p className="text-sm text-muted-foreground">You haven&apos;t connected anything yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last polled</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {listing.connections.map((connection) => (
              <TableRow key={connection.id}>
                <TableCell>{SOURCE_NAMES[connection.source]}</TableCell>
                <TableCell>{connection.accountEmail}</TableCell>
                <TableCell>
                  <StatusBadge
                    status={connection.status}
                    backfilledItems={connection.backfilledItems}
                  />
                </TableCell>
                <TableCell>
                  <LastPolled at={connection.lastPolledAt} />
                </TableCell>
                <TableCell className="text-right">
                  <ConnectionControls connection={connection} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {isAdmin ? <AdminConnections listing={listing} /> : null}
    </div>
  );
}
