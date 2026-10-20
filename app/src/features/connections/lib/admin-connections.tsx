import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ConnectionOwner, ConnectionsListing } from "../types";
import { ConnectButton } from "./connect-button";
import { ConnectionApps, ConnectionControls, ConnectionNotices } from "./connection-controls";
import { LastPolled, StatusBadge } from "./status-badge";

/** The admin-only part of the connections page: org connections, and members' connections. */
export function AdminConnections({ listing }: { listing: ConnectionsListing }) {
  return (
    <>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Org connections</h2>
        <div className="flex gap-2">
          <ConnectButton kind="org" label="Connect an org Google account" />
        </div>
        <ConnectionNotices connections={listing.orgConnections} />
        {listing.orgConnections.length === 0 ? (
          <p className="text-sm text-muted-foreground">No org connections yet.</p>
        ) : (
          <Table aria-label="Org connections">
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Apps</TableHead>
                <TableHead>Connected by</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last polled</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {listing.orgConnections.map((connection) => (
                <TableRow key={connection.id}>
                  <TableCell>{connection.accountEmail}</TableCell>
                  <TableCell className="min-w-32 whitespace-normal">
                    <ConnectionApps connection={connection} />
                  </TableCell>
                  <TableCell>
                    <OwnerName owner={connection.owner} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      status={connection.status}
                      backfilledItems={connection.backfilledItems}
                    />
                  </TableCell>
                  <TableCell>
                    <LastPolled at={connection.lastPolledAt} />
                  </TableCell>
                  <TableCell className="text-right whitespace-normal">
                    <ConnectionControls connection={connection} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Members&apos; connections</h2>
        {listing.memberConnections.length === 0 ? (
          <p className="text-sm text-muted-foreground">No other member has connected anything.</p>
        ) : (
          <Table aria-label="Members' connections">
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Apps</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listing.memberConnections.map((connection) => (
                <TableRow key={connection.id}>
                  <TableCell>
                    <OwnerName owner={connection.owner} />
                  </TableCell>
                  <TableCell className="min-w-32 whitespace-normal">
                    <ConnectionApps connection={connection} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={connection.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </>
  );
}

function OwnerName({ owner }: { owner: ConnectionOwner }) {
  return owner.removed ? (
    <Badge variant="destructive">Connected by a removed user</Badge>
  ) : (
    <>{owner.name}</>
  );
}
