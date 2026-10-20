import type { ConnectionSummary } from "../types";
import { DisconnectButton } from "./disconnect-button";
import { ReconnectButton } from "./reconnect-button";
import { SOURCE_NAMES } from "./source-names";

/**
 * Tells whoever manages these connections (the owner, or admins for org connections) which ones
 * Google stopped accepting Mycel's access to: polling skips them until they're reconnected.
 */
export function ReauthNotices({ connections }: { connections: ConnectionSummary[] }) {
  return connections
    .filter((connection) => connection.status === "needs_reauth")
    .map((connection) => (
      <p key={connection.id} role="status" className="text-sm text-destructive">
        Google stopped accepting Mycel&apos;s access to {connection.accountEmail}. Reconnect it to
        pick up new {SOURCE_NAMES[connection.source]} activity again.
      </p>
    ));
}

/** A connection's controls: Reconnect when Google stopped accepting it, and Disconnect. */
export function ConnectionControls({ connection }: { connection: ConnectionSummary }) {
  return (
    <div className="flex items-start justify-end gap-2">
      {connection.status === "needs_reauth" ? (
        <ReconnectButton connectionId={connection.id} accountEmail={connection.accountEmail} />
      ) : null}
      <DisconnectButton connectionId={connection.id} accountEmail={connection.accountEmail} />
    </div>
  );
}
