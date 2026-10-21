"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { archiveWorkflowAction, restoreWorkflowAction } from "../actions";
import { Problems } from "./workflow-editor";

/**
 * Archive, or Restore while archived. Archiving stops new runs for everyone who has the
 * workflow on and for its org switch, and hides it from members; their switches are kept, so
 * restoring brings them back as they were.
 */
export function ArchiveForm({
  workflowId,
  archivedAt,
}: {
  workflowId: string;
  archivedAt: Date | null;
}) {
  const [archiveResult, archive, archiving] = useActionState(archiveWorkflowAction, {});
  const [restoreResult, restore, restoring] = useActionState(restoreWorkflowAction, {});
  if (archivedAt !== null) {
    return (
      <form action={restore} className="flex flex-col gap-2 text-sm">
        <input type="hidden" name="workflowId" value={workflowId} />
        <p>
          Archived since {archivedAt.toLocaleString("en-US")}. Members don&apos;t see it, and new
          mail starts no runs. Restoring brings back everyone&apos;s switches as they were, on the
          same version.
        </p>
        <div>
          <Button type="submit" disabled={restoring}>
            Restore
          </Button>
        </div>
        <Problems result={restoreResult} />
      </form>
    );
  }
  return (
    <form action={archive} className="flex flex-col gap-2 text-sm">
      <input type="hidden" name="workflowId" value={workflowId} />
      <p className="text-muted-foreground">
        Archiving stops it for everyone who has it on, and for the org switch, and hides it from
        members. Their switches are kept, so you can restore it later. Reviews already waiting stay
        until they&apos;re handled.
      </p>
      <div>
        <Button type="submit" variant="outline" disabled={archiving}>
          Archive
        </Button>
      </div>
      <Problems result={archiveResult} />
    </form>
  );
}
