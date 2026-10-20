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
import { DisconnectButton } from "./disconnect-button";
import { SOURCE_NAMES } from "./source-names";

/** The admin-only part of the connections page: org connections, and members' connections. */
export function AdminConnections({ listing }: { listing: ConnectionsListing }) {
  return (
    <>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Org connections</h2>
        <div className="flex gap-2">
          <ConnectButton source="gmail" kind="org" label="Connect an org inbox" />
        </div>
        {listing.orgConnections.length === 0 ? (
          <p className="text-sm text-muted-foreground">No org connections yet.</p>
        ) : (
          <Table aria-label="Org connections">
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Connected by</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {listing.orgConnections.map((connection) => (
                <TableRow key={connection.id}>
                  <TableCell>{SOURCE_NAMES[connection.source]}</TableCell>
                  <TableCell>{connection.accountEmail}</TableCell>
                  <TableCell>
                    <OwnerName owner={connection.owner} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{connection.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <DisconnectButton
                      connectionId={connection.id}
                      accountEmail={connection.accountEmail}
                    />
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
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listing.memberConnections.map((connection) => (
                <TableRow key={connection.id}>
                  <TableCell>
                    <OwnerName owner={connection.owner} />
                  </TableCell>
                  <TableCell>{SOURCE_NAMES[connection.source]}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{connection.status}</Badge>
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
