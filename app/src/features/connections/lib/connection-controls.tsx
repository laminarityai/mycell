import { GOOGLE_APP_SCOPES, type ConnectionSummary, type Source } from "../types";
import { DisconnectButton } from "./disconnect-button";
import { ReconnectButton } from "./reconnect-button";
import { appList, SOURCE_NAMES } from "./source-names";

/**
 * Tells whoever manages these connections (the owner, or admins for org connections) what
 * needs them: a connection its app stopped accepting Mycel's access to (polling skips it until
 * it's reconnected), apps a Google connection wasn't allowed, one-app connections from before
 * one Google connection per account, which connecting Google replaces, and Gmail read without
 * the write access workflows' labels and drafts need (ADR-0011).
 */
export function ConnectionNotices({ connections }: { connections: ConnectionSummary[] }) {
  return connections.flatMap((connection) => {
    const notice = noticeFor(connection);
    return notice === undefined
      ? []
      : [
          <p
            key={connection.id}
            role="status"
            className={
              connection.status === "needs_reauth"
                ? "text-sm text-destructive"
                : "text-sm text-muted-foreground"
            }
          >
            {notice}
          </p>,
        ];
  });
}

function noticeFor(connection: ConnectionSummary): string | undefined {
  const account = connection.accountEmail;
  if (connection.status === "needs_reauth") {
    if (connection.source === "pipedrive") {
      return `Pipedrive stopped accepting Mycel's access to ${account}. Reconnect it so workflows can use it again.`;
    }
    return `Google stopped accepting Mycel's access to ${account}. Reconnect it to pick up new ${appList(connection.apps)} activity again.`;
  }
  if (isOneApp(connection.source)) {
    const write = needsWriteAccess(connection)
      ? " Until then, workflows can't label or draft in it: reconnect it to grant write access."
      : "";
    return `${account}'s ${SOURCE_NAMES[connection.source]} connection is from before one Google connection per account. Connect Google for ${account} to switch to one Google connection: it replaces this one, and backfills again.${write}`;
  }
  if (connection.missingApps.length > 0) {
    return `${account} doesn't allow ${appList(connection.missingApps)}. Reconnect to allow ${appList(connection.missingApps)}.`;
  }
  return undefined;
}

/**
 * Whether the connection reads Gmail without gmail.modify, which labelling and drafting need:
 * a one-app connection from before write access was asked for.
 */
function needsWriteAccess(connection: ConnectionSummary): boolean {
  return (
    connection.apps.includes("gmail") && !connection.grantedScopes.includes(GOOGLE_APP_SCOPES.gmail)
  );
}

/**
 * A connection's controls: Reconnect when Google stopped accepting it, to allow apps a Google
 * connection wasn't granted, or to grant Gmail write access, and Disconnect.
 */
export function ConnectionControls({ connection }: { connection: ConnectionSummary }) {
  const allow = connection.source === "google" ? connection.missingApps : [];
  const reconnectLabel =
    connection.status === "needs_reauth"
      ? "Reconnect"
      : allow.length > 0
        ? `Reconnect to allow ${appList(allow)}`
        : needsWriteAccess(connection)
          ? "Reconnect to grant write access"
          : undefined;
  return (
    <div className="flex flex-wrap items-start justify-end gap-2">
      {reconnectLabel === undefined ? null : (
        <ReconnectButton
          connectionId={connection.id}
          accountEmail={connection.accountEmail}
          label={reconnectLabel}
        />
      )}
      <DisconnectButton connectionId={connection.id} accountEmail={connection.accountEmail} />
    </div>
  );
}

/**
 * Which apps a connection reaches, as a table cell's text: the Google apps it allows, or
 * another registered app by name.
 */
export function ConnectionApps({
  connection,
}: {
  connection: Pick<ConnectionSummary, "source" | "apps">;
}) {
  if (isOneApp(connection.source)) {
    return <>{SOURCE_NAMES[connection.source]} only (old connection)</>;
  }
  if (connection.source !== "google") return <>{SOURCE_NAMES[connection.source]}</>;
  return <>{connection.apps.length === 0 ? "No apps" : appList(connection.apps)}</>;
}

/** A one-app connection from before one Google connection per account (ADR-0014). */
function isOneApp(source: Source): boolean {
  return source === "gmail" || source === "drive";
}
