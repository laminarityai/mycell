"use client";

import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { startReconnectAction } from "../actions";
import { useConnectUI } from "./connect-ui";

/**
 * Re-authorizes a connection in Nango's Connect UI: one Google stopped accepting, or one that
 * should allow more apps. The page refreshes once the popup closes, and `onDone` (the return
 * target) is called when there is one; Nango's webhook then records what Google granted.
 */
export function ReconnectButton({
  connectionId,
  accountEmail,
  label,
  onDone,
}: {
  connectionId: string;
  accountEmail: string;
  label: string;
  onDone?: () => void;
}) {
  const { open, error, pending } = useConnectUI(() => startReconnectAction(connectionId), onDone);

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
      <FormError message={error} />
    </div>
  );
}
