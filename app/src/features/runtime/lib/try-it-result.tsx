// A "Try it" result: each step with what it did, read or would have written, and the total
// cost. The draft's text and the rows read are shown here and nowhere else (invariant 8).
import { Badge } from "@/components/ui/badge";
import type { DryRunEffect, DryRunResult, DryRunStep } from "../types";

const ENDINGS: Record<DryRunResult["ended"], string> = {
  succeeded: "Ran to the end.",
  skipped: "Stopped at a branch: the workflow would do nothing more with this message.",
  escalated: "Escalated: the workflow would hand this message to a person.",
  failed: "Failed at the step marked below.",
};

/** Rows of a read range shown, at most. */
const ROWS_SHOWN = 20;

function usd(amount: number): string {
  return `$${amount.toFixed(4)}`;
}

export function TryItResult({ result }: { result: DryRunResult }) {
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
            <StepOutcome step={step} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function StepOutcome({ step }: { step: DryRunStep }) {
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
  if (step.type === "branch") {
    return <p>{output.passed === true ? "Condition met: went on." : "Condition not met."}</p>;
  }
  return (
    <code className="font-mono text-xs wrap-anywhere text-muted-foreground">
      {JSON.stringify(output)}
    </code>
  );
}

function Effect({ effect }: { effect: DryRunEffect }) {
  switch (effect.kind) {
    case "review":
      return <p>Would wait for a review.</p>;
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
