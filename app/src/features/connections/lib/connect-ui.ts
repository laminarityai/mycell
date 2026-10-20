"use client";

import Nango from "@nangohq/frontend";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/** A Server Action that starts a connect (or reconnect) session. */
type StartSession = () => Promise<{ token: string } | { error: string }>;

/**
 * Opens Nango's Connect UI with the session `start` creates, and refreshes the page once the
 * popup closes. The popup opens first, inside the click, so the browser doesn't block it.
 */
export function useConnectUI(start: StartSession) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function open() {
    setError(undefined);
    const connectUI = new Nango().openConnectUI({
      onEvent: (event) => {
        if (event.type === "close" || event.type === "connect") router.refresh();
      },
    });
    startTransition(async () => {
      const result = await start();
      if ("error" in result) {
        connectUI.close();
        setError(result.error);
        return;
      }
      connectUI.setSessionToken(result.token);
      router.refresh();
    });
  }

  return { open, error, pending };
}
