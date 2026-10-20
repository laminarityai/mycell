"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { switchWorkflowOffAction, switchWorkflowOnAction } from "../actions";
import type { WorkflowSwitch } from "../types";
import { Problems } from "./workflow-editor";

/** A connection the workflow can be switched on for, as the form offers it. */
export type SwitchConnectionOption = { id: string; label: string };

/**
 * The workflow's switch: where it's on and since when, with Switch off; or, while off, the
 * connections it may run on, with Switch on.
 */
export function SwitchForm({
  workflowId,
  current,
  connections,
  published,
}: {
  workflowId: string;
  current: WorkflowSwitch | null;
  connections: SwitchConnectionOption[];
  published: boolean;
}) {
  const [onResult, switchOn, switchingOn] = useActionState(switchWorkflowOnAction, {});
  const [offResult, switchOff, switchingOff] = useActionState(switchWorkflowOffAction, {});
  if (current !== null) {
    const label =
      connections.find((connection) => connection.id === current.connectionId)?.label ??
      "a connection";
    return (
      <form action={switchOff} className="flex flex-col gap-2 text-sm">
        <input type="hidden" name="workflowId" value={workflowId} />
        <p>
          On for {label} since {current.since.toLocaleString("en-US")}. It runs on each new inbound
          message from then on.
        </p>
        <div>
          <Button type="submit" variant="outline" disabled={switchingOff}>
            Switch off
          </Button>
        </div>
        <Problems result={offResult} />
      </form>
    );
  }
  if (!published) {
    return <p className="text-sm text-muted-foreground">Publish the workflow to switch it on.</p>;
  }
  if (connections.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Connect a Google account this workflow can run on to switch it on.
      </p>
    );
  }
  return (
    <form action={switchOn} className="flex flex-col gap-3">
      <input type="hidden" name="workflowId" value={workflowId} />
      <label className="flex flex-col gap-1 text-sm font-medium">
        Connection
        <select
          name="connectionId"
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          defaultValue={connections[0]?.id}
        >
          {connections.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-sm text-muted-foreground">
        It runs on messages that arrive after you switch it on, never on earlier ones.
      </p>
      <div>
        <Button type="submit" disabled={switchingOn}>
          Switch on
        </Button>
      </div>
      <Problems result={onResult} />
    </form>
  );
}
