"use client";

import Nango from "@nangohq/frontend";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/** A Server Action that starts a connect (or reconnect) session. */
type StartSession = () => Promise<{ token: string } | { error: string }>;

/**
 * Opens Nango's Connect UI with the session `start` creates, and refreshes the page once the
 * popup closes. The popup opens first, inside the click, so the browser doesn't block it.
 * `onDone` is the return target: called once, when the popup connects or closes, so the page can carry on
 * with what sent the user there (enabling a workflow, say). Nango's webhook records the
 * connection and what Google granted shortly after, so `onDone` may find it not there yet.
 */
export function useConnectUI(start: StartSession, onDone?: () => void) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function open() {
    setError(undefined);
    let done = false;
    const connectUI = new Nango().openConnectUI({
      onEvent: (event) => {
        if (event.type !== "close" && event.type !== "connect") return;
        router.refresh();
        if (!done) {
          done = true;
          onDone?.();
        }
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
