"use client";

import { Button } from "@/components/ui/button";
import { startReconnectAction } from "../actions";
import { useConnectUI } from "./connect-ui";

/**
 * Re-authorizes a connection in Nango's Connect UI: one Google stopped accepting, or one that
 * should allow more apps. The page refreshes once the popup closes; Nango's webhook then
 * records what Google granted.
 */
export function ReconnectButton({
  connectionId,
  accountEmail,
  label,
}: {
  connectionId: string;
  accountEmail: string;
  label: string;
}) {
  const { open, error, pending } = useConnectUI(() => startReconnectAction(connectionId));

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        onClick={open}
        disabled={pending}
        aria-label={`${label} for ${accountEmail}`}
      >
        {label}
      </Button>
      {error === undefined ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
