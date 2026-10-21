"use client";

// The side panel the graph opens on what the admin clicked: 360px over the graph's right edge,
// or a bottom sheet on a narrow screen. It edits the step or path in place; every change goes
// straight to the working spec being edited, and live validation's issues about it are listed.
import { triggerFacts } from "@/features/spec/triggers";
import type { GraphSelection } from "./graph-drawing";
import { PanelShell, type PanelProps } from "./panel-shell";
import { OtherwiseForm, PathForm, pathPlace } from "./path-form";
import { StepForm } from "./step-form";

export function SidePanel({ selection, ...props }: PanelProps & { selection: GraphSelection }) {
  return (
    <aside
      aria-label="Editor"
      className="nodrag nopan nowheel absolute z-20 flex flex-col gap-3 overflow-y-auto bg-background p-4 shadow-xl max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[75%] max-md:rounded-t-2xl max-md:border-t md:inset-y-0 md:right-0 md:w-[360px] md:border-l"
    >
      <Selected selection={selection} {...props} />
    </aside>
  );
}

function Selected({ selection, ...props }: PanelProps & { selection: GraphSelection }) {
  if (selection.kind === "trigger") {
    return (
      <PanelShell
        title="Trigger"
        subtitle="When a message arrives in Gmail"
        onClose={props.onClose}
      >
        <p className="text-sm">Change the labels it watches in the settings under the graph.</p>
        <p className="text-xs text-muted-foreground">
          Facts a condition may test:{" "}
          {triggerFacts[props.spec.trigger.type].map((fact) => fact.label).join(", ")}.
        </p>
      </PanelShell>
    );
  }
  if (selection.kind === "path") {
    const place = pathPlace(props.spec, selection.id);
    if (place === undefined) return <Gone {...props} />;
    return place.path === null ? (
      <OtherwiseForm branch={place.branch} {...props} />
    ) : (
      <PathForm branch={place.branch} path={place.path} index={place.index} {...props} />
    );
  }
  if (selection.byPolicy) {
    return (
      <PanelShell title="Waits for review" subtitle="Required by policy" onClose={props.onClose}>
        <p className="text-sm">
          The catalog says a Gmail draft is an <strong>external send</strong>, so the policy engine
          adds this review after a draft with none. A person sends or deletes the draft in Gmail.
        </p>
        <p className="text-xs text-muted-foreground">
          It can&apos;t be removed here, or by the builder. A branch chooses a path but never
          removes a review.
        </p>
      </PanelShell>
    );
  }
  return <StepForm stepId={selection.id} {...props} />;
}

/** What was selected is no longer in the working spec. */
function Gone({ onClose }: PanelProps) {
  return (
    <PanelShell title="Not in the workflow" onClose={onClose}>
      <p className="text-sm text-muted-foreground">This isn&apos;t in the workflow any more.</p>
    </PanelShell>
  );
}
