"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/errors";
import { publishWorkflowAction, saveWorkflowAction } from "../actions";

/**
 * The spec's name and JSON, and Save. The fields are controlled, so a refused save keeps what
 * the admin typed (a form action would otherwise reset them).
 */
export function WorkflowForm({
  workflowId,
  name: savedName = "",
  spec: savedSpec = "",
}: {
  workflowId?: string;
  name?: string;
  spec?: string;
}) {
  const [result, save, saving] = useActionState(saveWorkflowAction, {});
  const [name, setName] = useState(savedName);
  const [spec, setSpec] = useState(savedSpec);
  return (
    <form action={save} className="flex flex-col gap-3">
      {workflowId === undefined ? null : (
        <input type="hidden" name="workflowId" value={workflowId} />
      )}
      <label className="flex flex-col gap-1 text-sm font-medium">
        Name
        <Input
          name="name"
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Spec (JSON)
        <Textarea
          name="spec"
          required
          rows={24}
          spellCheck={false}
          className="font-mono text-xs"
          value={spec}
          onChange={(event) => {
            setSpec(event.target.value);
          }}
        />
      </label>
      <div>
        <Button type="submit" disabled={saving}>
          Save
        </Button>
      </div>
      <Problems result={result} />
    </form>
  );
}

export function PublishButton({ workflowId }: { workflowId: string }) {
  const [result, publish, publishing] = useActionState(publishWorkflowAction, {});
  return (
    <form action={publish} className="flex flex-col gap-2">
      <input type="hidden" name="workflowId" value={workflowId} />
      <div>
        <Button type="submit" variant="outline" disabled={publishing}>
          Publish
        </Button>
      </div>
      <Problems result={result} />
    </form>
  );
}

/** The action's error, with every spec issue at the path it's about. */
function Problems({ result }: { result: ActionResult }) {
  if (result.error === undefined) return null;
  return (
    <div role="alert" className="flex flex-col gap-1 text-sm text-destructive">
      <p>{result.error}</p>
      {result.issues === undefined ? null : (
        <ul className="list-disc pl-5">
          {result.issues.map((issue) => (
            <li key={`${issue.path.join(".")}:${issue.message}`}>
              {issue.path.length > 0 ? (
                <code className="mr-1 font-mono">{issue.path.join(".")}</code>
              ) : null}
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
