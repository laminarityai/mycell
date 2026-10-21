"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ConnectButton, ReconnectButton } from "@/features/connections/ui";
import { disableWorkflowAction, enableWorkflowAction } from "../actions";
import type { EnableResult, WorkflowSwitch } from "../types";

type Needs = Exclude<EnableResult, { enabled: true }>;

// After the Google popup, Nango's webhook records the connection and what it was granted a
// moment later: enabling is tried again a few times before the page says what's still missing.
const RETRIES = 5;
const RETRY_MS = 1500;

/**
 * A member's switch for one member-credential workflow. Switching on enables it for their own
 * Google connection; when that's missing or short of an app, it offers connecting or
 * reconnecting, and enables once they're back from Google. A paused enablement has buttons
 * instead: enabling it again (which takes them through reconnecting too when the new version
 * needs an app or scope their connection lacks), or switching it off.
 */
export function EnableSwitch({
  workflowId,
  name,
  current,
}: {
  workflowId: string;
  name: string;
  current: WorkflowSwitch | null;
}) {
  const [needs, setNeeds] = useState<Needs | null>(null);
  const [error, setError] = useState<string>();
  const [finishing, setFinishing] = useState(false);
  const [pending, startTransition] = useTransition();
  const on = current?.kind === "member" && current.status === "on";
  const paused = current?.kind === "member" && current.status === "paused";

  function show(result: EnableResult | { error: string }) {
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setError(undefined);
    setNeeds("needs" in result ? result : null);
  }

  function change(checked: boolean) {
    startTransition(async () => {
      if (checked) {
        show(await enableWorkflowAction(workflowId));
        return;
      }
      setNeeds(null);
      setError((await disableWorkflowAction(workflowId)).error);
    });
  }

  // The return target of connecting or reconnecting.
  function enableAgain() {
    setFinishing(true);
    startTransition(async () => {
      for (let attempt = 1; ; attempt += 1) {
        const result = await enableWorkflowAction(workflowId);
        if (!("needs" in result) || attempt === RETRIES) {
          show(result);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      }
      setFinishing(false);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {paused ? (
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              change(true);
            }}
            disabled={pending}
          >
            Re-enable
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              change(false);
            }}
            disabled={pending}
          >
            Switch off
          </Button>
        </div>
      ) : (
        <Switch checked={on} onCheckedChange={change} disabled={pending} aria-label={name} />
      )}
      {finishing ? <p className="text-muted-foreground">Finishing switching it on…</p> : null}
      {needs === null || finishing ? null : <NeedsNotice needs={needs} onDone={enableAgain} />}
      {error === undefined ? null : (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function NeedsNotice({ needs, onDone }: { needs: Needs; onDone: () => void }) {
  const access = `${needs.apps.join(" and ")} (${needs.scopes.join(", ")})`;
  if (needs.needs === "connect") {
    return (
      <div className="flex flex-col items-start gap-2">
        <p>Connect your Google account to switch this on. It needs {access}.</p>
        <ConnectButton kind="member" label="Connect Google" onDone={onDone} />
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <p>
        Your Google account doesn&apos;t allow {access}. Reconnect Google and allow it to switch
        this on.
      </p>
      <ReconnectButton
        connectionId={needs.connectionId}
        accountEmail="your Google account"
        label="Reconnect Google"
        onDone={onDone}
      />
    </div>
  );
}
