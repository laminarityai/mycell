"use client";

import { useActionState } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { startConversationAction } from "../actions";

/** Starts a conversation, about one workflow when `workflowId` is set, and opens it. */
export function NewConversationButton({ workflowId }: { workflowId?: string }) {
  const [result, start, starting] = useActionState(startConversationAction, {});
  return (
    <form action={start} className="flex flex-col gap-1">
      {workflowId === undefined ? null : (
        <input type="hidden" name="workflowId" value={workflowId} />
      )}
      <div>
        <Button type="submit" disabled={starting}>
          New conversation
        </Button>
      </div>
      <FormError message={result.error} />
    </form>
  );
}
