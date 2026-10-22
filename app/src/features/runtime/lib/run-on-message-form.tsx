"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { startRunAction } from "../actions";

/** A connection the workflow can run on, as the form offers it. */
export type RunConnectionOption = { id: string; label: string };

/**
 * Runs the workflow's latest version on one Gmail message by ID: a debugging aid beside the
 * trigger.
 */
export function RunOnMessageForm({
  workflowId,
  connections,
}: {
  workflowId: string;
  connections: RunConnectionOption[];
}) {
  const [result, start, starting] = useActionState(startRunAction, {});
  if (connections.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Connect a Google account this workflow can run on to try it on a message.
      </p>
    );
  }
  // React resets the form after its action: a refused run starts from what it sent.
  return (
    <form action={start} className="flex flex-col gap-3">
      <input type="hidden" name="workflowId" value={workflowId} />
      <label className="flex flex-col gap-1 text-sm font-medium">
        Connection
        <select
          name="connectionId"
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          defaultValue={result.values?.connectionId ?? connections[0]?.id}
        >
          {connections.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Gmail message ID
        <Input
          name="sourceRef"
          defaultValue={result.values?.sourceRef}
          required
          className="font-mono"
        />
      </label>
      <div>
        <Button type="submit" variant="outline" disabled={starting}>
          Run on this message
        </Button>
      </div>
      {result.error === undefined ? null : (
        <p role="alert" className="text-sm text-destructive">
          {result.error}
        </p>
      )}
    </form>
  );
}
