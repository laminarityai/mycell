"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { resumeWorkflowAction } from "../actions";
import { Problems } from "./workflow-editor";

/** Resume: lifts a failure pause, so new messages start runs again for every switch of it. */
export function ResumeForm({ workflowId }: { workflowId: string }) {
  const [result, resume, resuming] = useActionState(resumeWorkflowAction, {});
  return (
    <form action={resume} className="flex flex-col gap-2 text-sm">
      <input type="hidden" name="workflowId" value={workflowId} />
      <div>
        <Button type="submit" disabled={resuming}>
          Resume
        </Button>
      </div>
      <Problems result={result} />
    </form>
  );
}
