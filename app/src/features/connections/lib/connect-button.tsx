"use client";

import { Button } from "@/components/ui/button";
import { startConnectAction } from "../actions";
import type { ConnectionKind, Source } from "../types";
import { useConnectUI } from "./connect-ui";

/** Opens Nango's Connect UI for one source, then refreshes once the popup closes. */
export function ConnectButton({
  source,
  kind,
  label,
}: {
  source: Source;
  kind: ConnectionKind;
  label: string;
}) {
  const { open, error, pending } = useConnectUI(() => startConnectAction(source, kind));

  return (
    <div className="flex flex-col gap-1">
      <Button onClick={open} disabled={pending}>
        {label}
      </Button>
      {error === undefined ? null : <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
