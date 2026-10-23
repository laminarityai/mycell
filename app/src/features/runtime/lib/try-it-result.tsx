// A "Try it" result: each step with what it did, read or would have written, and the total
// cost. The draft's text and the rows read are shown here and nowhere else (invariant 8).
import { Badge } from "@/components/ui/badge";
import { documentLink } from "@/features/connections/docs";
import type { BranchPath, DryRunEffect, DryRunResult, DryRunStep } from "../types";

const ENDINGS: Record<DryRunResult["ended"], string> = {
  succeeded: "Ran to the end.",
  skipped: "Stopped at a branch: the workflow would do nothing more with it.",
  escalated: "Escalated: the workflow would hand this message to a person.",
  failed: "Failed at the step marked below.",
  partly_failed:
    "Partly failed: the step marked below failed and ended its own path, and the other paths ran on.",
};

/** Rows of a read range shown, at most. */
const ROWS_SHOWN = 20;

function usd(amount: number): string {
  return `$${amount.toFixed(4)}`;
}

/** `onGraph` when the page's workflow graph shows each path's result, so the list needn't. */
export function TryItResult({
  result,
  onGraph = false,
}: {
  result: DryRunResult;
  onGraph?: boolean;
}) {
  return (
    <section aria-label="Try it result" className="flex flex-col gap-3">
      <p className="text-sm">
        {ENDINGS[result.ended]} Nothing was written to any app. Cost {usd(result.costUsd)}.
      </p>
      <ol className="flex flex-col gap-2">
        {result.steps.map((step) => (
          <li key={step.stepId} className="flex flex-col gap-1 rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <code className="font-mono text-xs">{step.stepId}</code>
              <span className="text-muted-foreground">{step.type}</span>
              {step.status === "succeeded" ? null : (
                <Badge variant="destructive">
                  {step.status === "check_failed" ? "Check failed" : "Failed"}
                </Badge>
              )}
              {step.insertedByPolicy ? <Badge variant="outline">Required by policy</Badge> : null}
              {step.costUsd > 0 ? (
                <span className="text-xs text-muted-foreground">{usd(step.costUsd)}</span>
              ) : null}
            </div>
            <StepOutcome step={step} onGraph={onGraph} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function StepOutcome({ step, onGraph }: { step: DryRunStep; onGraph: boolean }) {
  if (step.error !== null) {
    return <p className="text-destructive">{step.error.message}</p>;
  }
  if (step.effect !== null) return <Effect effect={step.effect} />;
  const output = step.output;
  if (typeof output !== "object" || output === null || Array.isArray(output)) return null;
  if (step.type === "classify") {
    return (
      <p>
        Chose <strong>{JSON.stringify(output.label)}</strong> with probability{" "}
        {JSON.stringify(output.p)}.
      </p>
    );
  }
  if (step.type === "branch" && step.paths !== undefined) {
    if (!onGraph) return <BranchPaths paths={step.paths} />;
    const taken = step.paths.flatMap((path) =>
      path.status === "taken" ? [path.name ?? "Otherwise"] : [],
    );
    return (
      <p>
        Took {taken.length === 0 ? "no path" : taken.join(", ")}. The graph shows why each path did
        or didn&apos;t run.
      </p>
    );
  }
  if (step.type === "branch") {
    const taken = Array.isArray(output.taken) ? output.taken.map(String) : [];
    return <p>Took the path {taken.join(", ")}.</p>;
  }
  return (
    <code className="font-mono text-xs wrap-anywhere text-muted-foreground">
      {JSON.stringify(output)}
    </code>
  );
}

const PATH_STATUSES: Record<BranchPath["status"], string> = {
  taken: "Ran",
  not_taken: "Didn't apply",
  not_checked: "Not checked: an earlier path ran",
  not_needed: "Not needed: another path applied",
};

/** Each path out of the branch, and why each check passed or failed, values included. */
function BranchPaths({ paths }: { paths: BranchPath[] }) {
  return (
    <ul aria-label="Paths" className="flex flex-col gap-2">
      {paths.map((path) => (
        <li key={path.id} className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong>{path.name ?? "Otherwise"}</strong>
            <Badge variant={path.status === "taken" ? "default" : "outline"}>
              {PATH_STATUSES[path.status]}
            </Badge>
          </div>
          {path.checks.length === 0 ? null : (
            <ul className="flex flex-col gap-0.5 pl-4 text-muted-foreground">
              {path.checks.map((check, index) => (
                <li key={index}>
                  {check.passed ? "Passed" : "Failed"}: {check.check}. It {check.reason}.
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function Effect({ effect }: { effect: DryRunEffect }) {
  switch (effect.kind) {
    case "review":
      return <p>Would wait for a review.</p>;
    case "request":
      return (
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground">
            Would hold this request to {effect.app} ({effect.action}) for a review, and send it once
            approved:
          </p>
          <pre
            aria-label="Request"
            className="rounded bg-muted p-2 font-mono text-xs break-all whitespace-pre-wrap"
          >
            {`${effect.method} ${effect.url}`}
            {effect.body === null ? "" : `\n\n${JSON.stringify(effect.body, null, 2)}`}
          </pre>
        </div>
      );
    case "suggestions":
      return (
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground">
            Would suggest these edits in{" "}
            <a
              href={documentLink(effect.documentId)}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              {effect.title === "" ? "the doc" : effect.title}
            </a>
            , waiting as suggestions until a person reviews them:
          </p>
          <ul aria-label="Suggested edits" className="list-disc pl-5 font-mono text-xs">
            {effect.requests.map((request, index) => (
              <li key={index} className="break-all">
                {request}
              </li>
            ))}
          </ul>
        </div>
      );
    case "label":
      return (
        <p>
          Would add the label <strong>{effect.label}</strong>.
        </p>
      );
    case "row":
      return (
        <p>
          Would append a row to <code className="font-mono text-xs">{effect.range}</code>:{" "}
          {effect.values.map((value) => String(value)).join(", ")}
        </p>
      );
    case "draft":
      return (
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground">
            Would draft a reply to {effect.to}, &ldquo;{effect.subject}&rdquo;:
          </p>
          <pre
            aria-label="Draft text"
            className="rounded bg-muted p-2 font-sans text-sm whitespace-pre-wrap"
          >
            {effect.text}
          </pre>
        </div>
      );
    case "rows_read":
      return (
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground">
            Read {effect.rows.length} rows from{" "}
            <code className="font-mono text-xs">{effect.range}</code>
            {effect.rows.length > ROWS_SHOWN ? `, the first ${String(ROWS_SHOWN)} shown` : ""}:
          </p>
          <table className="text-xs">
            <tbody>
              {effect.rows.slice(0, ROWS_SHOWN).map((row, index) => (
                <tr key={index}>
                  {row.map((cell, column) => (
                    <td key={column} className="border px-1">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}
