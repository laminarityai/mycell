"use client";

import { useActionState } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { startRunAction } from "../actions";

/** A connection the workflow can run on, as the form offers it. */
export type RunConnectionOption = { id: string; label: string };

/**
 * Runs the workflow's latest version on one Gmail message, or one calendar event for a
 * workflow that starts on a new invite, by ID: a debugging aid beside the trigger.
 */
export function RunOnMessageForm({
  workflowId,
  connections,
  item = "message",
}: {
  workflowId: string;
  connections: RunConnectionOption[];
  /** What the workflow's trigger starts a run on: a message, or an invite. */
  item?: string;
}) {
  const [result, start, starting] = useActionState(startRunAction, {});
  if (connections.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Connect a Google account this workflow can run on to try it on {article(item)} {item}.
      </p>
    );
  }
  // React resets the form after its action: a refused run starts from what it sent.
  return (
    <form action={start} className="flex flex-col gap-3">
      <input type="hidden" name="workflowId" value={workflowId} />
      <label className="flex flex-col gap-1 text-sm font-medium">
        Connection
        <NativeSelect
          name="connectionId"
          className="w-full"
          defaultValue={result.values?.connectionId ?? connections[0]?.id}
        >
          {connections.map((connection) => (
            <NativeSelectOption key={connection.id} value={connection.id}>
              {connection.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {item === "invite" ? "Calendar event ID" : "Gmail message ID"}
        <Input
          name="sourceRef"
          defaultValue={result.values?.sourceRef}
          required
          className="font-mono"
        />
      </label>
      <div>
        <Button type="submit" variant="outline" disabled={starting}>
          Run on this {item}
        </Button>
      </div>
      <FormError message={result.error} />
    </form>
  );
}

function article(word: string): string {
  return /^[aeiou]/.test(word) ? "an" : "a";
}
