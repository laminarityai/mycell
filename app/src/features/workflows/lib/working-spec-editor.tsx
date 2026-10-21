"use client";

// A workflow's working spec edited on its graph alone, as beside the builder chat: the same side
// panel and "+" as the workflow page, live validation, and a save bar over the graph once
// something changed. It saves over the revision it was opened at, so a working spec saved since
// (by hand or by an accepted proposal) is refused, never overwritten.
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { sameValue } from "@/features/spec/diff";
import type { SpecDraft } from "@/features/spec/draft";
import { formatSpec } from "@/features/spec/format";
import type { Spec } from "@/features/spec/types";
import { saveWorkflowAction } from "../actions";
import { GraphEditor } from "./graph-editor";
import { saveHint, useLiveCheck } from "./live-check";
import { SaveInputs } from "./save-inputs";
import { Problems } from "./workflow-editor";

export type EditableWorkflow = { id: string; name: string; workingSpec: Spec; revision: number };

/** Key it by the workflow and its revision, so a save's refresh starts it from what was saved. */
export function WorkingSpecEditor({ workflow }: { workflow: EditableWorkflow }) {
  const [result, save, saving] = useActionState(saveWorkflowAction, {});
  const [draft, setDraft] = useState<SpecDraft>(() => ({ ...workflow.workingSpec }));
  const specText = formatSpec(draft);
  const current = useLiveCheck(specText, true);
  const issues = current?.issues ?? [];
  const changed = !sameValue(draft, workflow.workingSpec);
  const ready = current !== null && current.error === undefined && issues.length === 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
        <GraphEditor draft={draft} onChange={setDraft} issues={issues} fill />
      </div>
      {changed || result.error !== undefined ? (
        <form
          action={save}
          aria-label="Save the workflow"
          className="flex flex-col gap-2 border-t bg-background px-4 py-2 text-sm"
        >
          <input type="hidden" name="name" value={workflow.name} />
          <SaveInputs workflowId={workflow.id} revision={workflow.revision} specText={specText} />
          <div className="flex items-center justify-between gap-2">
            <p aria-live="polite">
              <span className="font-medium">Unsaved changes.</span>{" "}
              <span className="text-muted-foreground">
                {saveHint(true, current, issues.length)}
              </span>
            </p>
            <Button type="submit" size="sm" disabled={saving || !ready}>
              Save
            </Button>
          </div>
          <Problems result={result} />
        </form>
      ) : null}
    </div>
  );
}
