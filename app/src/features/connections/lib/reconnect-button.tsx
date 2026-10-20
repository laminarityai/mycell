"use client";

import { Button } from "@/components/ui/button";
import { startReconnectAction } from "../actions";
import { useConnectUI } from "./connect-ui";

/**
 * Re-authorizes a connection Google stopped accepting, in Nango's Connect UI. The page
 * refreshes once the popup closes; Nango's webhook then makes the connection active again.
 */
export function ReconnectButton({
  connectionId,
  accountEmail,
}: {
  connectionId: string;
  accountEmail: string;
}) {
  const { open, error, pending } = useConnectUI(() => startReconnectAction(connectionId));

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" onClick={open} disabled={pending} aria-label={`Reconnect ${accountEmail}`}>
        Reconnect
      </Button>
      {error === undefined ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
