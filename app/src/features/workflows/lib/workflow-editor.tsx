"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/errors";
import { publishWorkflowAction } from "../actions";

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
export function Problems({ result }: { result: ActionResult }) {
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
