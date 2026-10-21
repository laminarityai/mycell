"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Tag } from "@/features/tags/types";
import type { ActionResult } from "@/lib/errors";
import { publishWorkflowAction } from "../actions";
import type { PublishPreview } from "../types";
import { pausedChangeText } from "./paused-text";

/**
 * Publish, in a dialog that picks the tags the version is published to and whether its reviews
 * may be handed on. It starts from the working spec's `visibility.tags` and `review.handoff`; a
 * name no tag has any more (renamed or deleted) is shown and left out. When the version needs more than the latest one did, it says what, and how many
 * enablements publishing pauses.
 */
export function PublishDialog({
  workflowId,
  nextNumber,
  tags,
  chosen,
  handoff,
  preview,
}: {
  workflowId: string;
  nextNumber: number;
  /** The org's tags. */
  tags: Tag[];
  /** The tag names the working spec is published to. */
  chosen: string[];
  /** Whether the working spec lets its reviews be handed on. */
  handoff: boolean;
  /** What publishing the working spec would pause; null when there's nothing to publish. */
  preview: PublishPreview | null;
}) {
  const [open, setOpen] = useState(false);
  const [result, publish, publishing] = useActionState(
    async (previous: ActionResult, form: FormData) => {
      const published = await publishWorkflowAction(previous, form);
      if (published.error === undefined) setOpen(false);
      return published;
    },
    {},
  );
  const names = new Set(tags.map((tag) => tag.name));
  const gone = chosen.filter((name) => !names.has(name));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div>
        <DialogTrigger asChild>
          <Button variant="outline">Publish</Button>
        </DialogTrigger>
      </div>
      <DialogContent>
        <form action={publish} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Publish version {nextNumber}</DialogTitle>
            <DialogDescription>
              Members with any of these tags see the workflow. Admins see every workflow.
            </DialogDescription>
          </DialogHeader>
          <input type="hidden" name="workflowId" value={workflowId} />
          <input type="hidden" name="chooseTags" value="1" />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Published to</legend>
            {tags.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Your org has no tags yet. Until you make one on the tags screen, only admins see
                this workflow.
              </p>
            ) : (
              tags.map((tag) => (
                <label key={tag.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    name="tag"
                    value={tag.name}
                    defaultChecked={chosen.includes(tag.name)}
                  />
                  {tag.name}
                </label>
              ))
            )}
            {gone.length === 0 ? null : (
              <p className="text-sm text-muted-foreground">
                No tag is called {gone.map((name) => `“${name}”`).join(", ")} any more, so it
                isn&apos;t ticked.
              </p>
            )}
          </fieldset>
          <label className="flex items-start gap-2 text-sm">
            <Switch name="handoff" defaultChecked={handoff} className="mt-0.5" />
            <span>
              Reviews can be handed on
              <span className="block text-muted-foreground">
                Whoever may act on a review can hand it to a colleague. A member&apos;s own review
                is handed on only by that member.
              </span>
            </span>
          </label>
          <PauseWarning preview={preview} />
          <Problems result={result} />
          <DialogFooter>
            <Button type="submit" disabled={publishing}>
              Publish version {nextNumber}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// What the new version needs that the latest didn't, and whose switches that pauses.
function PauseWarning({ preview }: { preview: PublishPreview | null }) {
  if (preview?.gained == null) return null;
  const people = preview.pauses === 1 ? "1 person" : `${String(preview.pauses)} people`;
  return (
    <div role="note" aria-label="What publishing pauses" className="flex flex-col gap-1 text-sm">
      <p className="font-medium">This version needs more than the latest one.</p>
      <ul className="list-disc pl-5">
        {pausedChangeText(preview.gained).map((change) => (
          <li key={change}>{change}</li>
        ))}
      </ul>
      {preview.pauses === 0 ? null : (
        <p>
          Publishing pauses it for {people} who switched it on, until each switches it on again.
        </p>
      )}
    </div>
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
