"use client";

import { Button } from "@/components/ui/button";
import { startConnectAction } from "../actions";
import type { ConnectionKind, RegisteredAppId } from "../types";
import { useConnectUI } from "./connect-ui";

/**
 * Opens Nango's Connect UI to connect an account in a registered app (Google unless `app`
 * says otherwise), then refreshes once the popup closes, and calls `onDone` (the return
 * target) when there is one.
 */
export function ConnectButton({
  app = "google",
  kind,
  label,
  onDone,
}: {
  app?: RegisteredAppId;
  kind: ConnectionKind;
  label: string;
  onDone?: () => void;
}) {
  const { open, error, pending } = useConnectUI(() => startConnectAction(app, kind), onDone);

  return (
    <div className="flex flex-col gap-1">
      <Button onClick={open} disabled={pending}>
        {label}
      </Button>
      {error === undefined ? null : <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
