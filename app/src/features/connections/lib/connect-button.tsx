"use client";

import Nango from "@nangohq/frontend";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { startConnectAction } from "../actions";
import type { ConnectionKind, Source } from "../types";

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
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function connect() {
    setError(undefined);
    const connectUI = new Nango().openConnectUI({
      onEvent: (event) => {
        if (event.type === "close" || event.type === "connect") router.refresh();
      },
    });
    startTransition(async () => {
      const result = await startConnectAction(source, kind);
      if ("error" in result) {
        connectUI.close();
        setError(result.error);
        return;
      }
      connectUI.setSessionToken(result.token);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Button onClick={connect} disabled={pending}>
        {label}
      </Button>
      {error === undefined ? null : <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
