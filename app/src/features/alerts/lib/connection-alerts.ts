// The connection alerts: an org connection, or the admin's own, that needs reconnecting or whose
// backfill failed. A colleague's own connection is theirs to fix, and they see it on their
// Connections page. Mycel records neither when access stopped nor when a backfill gave up, so
// neither has a start time.
import { REGISTERED_APPS, registeredAppOf } from "@/features/connections/registered-apps";
import type { ConnectionToFix } from "@/features/connections/types";
import type { Alert } from "../types";

export function connectionAlerts(connections: ConnectionToFix[]): Alert[] {
  return connections.map((connection) => {
    const subject = {
      type: "connection" as const,
      id: connection.id,
      source: connection.source,
      kind: connection.kind,
      accountEmail: connection.accountEmail,
    };
    const account = connection.accountEmail;
    if (connection.status === "needs_reauth") {
      const app = REGISTERED_APPS[registeredAppOf(connection.source)].name;
      return {
        id: `connection_reconnect:${connection.id}`,
        kind: "connection_reconnect",
        subject,
        startedAt: null,
        sentence: `${app} stopped accepting Mycel's access to ${account}, so nothing runs on it.`,
        clearsWhen: "Once it's reconnected.",
        fix: { label: "Reconnect", href: "/connections" },
      };
    }
    return {
      id: `backfill_failed:${connection.id}`,
      kind: "backfill_failed",
      subject,
      startedAt: null,
      sentence: `Mycel couldn't finish reading ${account}'s history, so discovery and memory are missing it.`,
      clearsWhen: "Once its history is read.",
      fix: { label: "Reconnect to retry", href: "/connections" },
    };
  });
}
