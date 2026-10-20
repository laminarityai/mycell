"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { disconnectAction } from "../actions";

/** Disconnects one connection, after a confirm step: it deletes everything derived from it. */
export function DisconnectButton({
  connectionId,
  accountEmail,
}: {
  connectionId: string;
  accountEmail: string;
}) {
  const [result, disconnect, disconnecting] = useActionState(disconnectAction, {});
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex flex-col items-end gap-1">
      {confirming ? (
        <form action={disconnect} className="flex gap-2">
          <input type="hidden" name="connectionId" value={connectionId} />
          <Button type="submit" variant="destructive" size="sm" disabled={disconnecting}>
            Confirm disconnect
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setConfirming(false);
            }}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Disconnect ${accountEmail}`}
          onClick={() => {
            setConfirming(true);
          }}
        >
          Disconnect
        </Button>
      )}
      {result.error === undefined ? null : (
        <p role="alert" className="text-sm text-destructive">
          {result.error}
        </p>
      )}
    </div>
  );
}
