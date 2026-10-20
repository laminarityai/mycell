import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConnectButton } from "./lib/connect-button";
import { DisconnectButton } from "./lib/disconnect-button";
import type { ConnectionsListing, Source } from "./types";

const SOURCE_NAMES: Record<Source, string> = { gmail: "Gmail" };

/** The caller's connections, their unfinished connect attempts, and the buttons to connect. */
export function ConnectionsPanel({ listing }: { listing: ConnectionsListing }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <ConnectButton source="gmail" label="Connect Gmail" />
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
            ? `Connecting ${SOURCE_NAMES[attempt.source]}…`
            : `Couldn't connect ${SOURCE_NAMES[attempt.source]}: ${attempt.refusal ?? "it was refused."}`}
        </p>
      ))}
      {listing.connections.length === 0 ? (
        <p className="text-sm text-muted-foreground">You haven&apos;t connected anything yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {listing.connections.map((connection) => (
              <TableRow key={connection.id}>
                <TableCell>{SOURCE_NAMES[connection.source]}</TableCell>
                <TableCell>{connection.accountEmail}</TableCell>
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
    </div>
  );
}
