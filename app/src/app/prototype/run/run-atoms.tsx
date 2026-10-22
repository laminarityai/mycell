// PROTOTYPE, throwaway: the small pieces a run's step is told with, whichever layout holds them:
// its status mark, its checks, its error with what to do, and its model and cost.
import { Check, CircleDashed, Clock, Lock, Wrench, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CHECK_NAME, type RunStep, type StepCheck, type StepError } from "./run-cases";

export function StatusMark({
  status,
  className,
}: {
  status: RunStep["status"];
  className?: string;
}) {
  const base = "inline-flex size-6 shrink-0 items-center justify-center rounded-full";
  switch (status) {
    case "succeeded":
      return (
        <span
          className={cn(base, "bg-emerald-100 text-emerald-700 dark:bg-emerald-950", className)}
        >
          <Check className="size-3.5" />
        </span>
      );
    case "failed":
    case "check_failed":
      return (
        <span className={cn(base, "bg-red-600 text-white", className)}>
          <X className="size-3.5" />
        </span>
      );
    case "waiting":
      return (
        <span className={cn(base, "bg-sky-100 text-sky-700 dark:bg-sky-950", className)}>
          <Clock className="size-3.5" />
        </span>
      );
    case "not_reached":
      return (
        <span className={cn(base, "border border-dashed text-muted-foreground", className)}>
          <CircleDashed className="size-3.5" />
        </span>
      );
  }
}

export function CheckList({ checks }: { checks: StepCheck[] }) {
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {checks.map((c) => (
        <li key={c.kind} className="flex items-start gap-2">
          {c.passed ? (
            <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          ) : (
            <X className="mt-0.5 size-4 shrink-0 text-red-600" />
          )}
          <span>
            <span className={cn("font-medium", !c.passed && "text-red-700 dark:text-red-400")}>
              {CHECK_NAME[c.kind]} check {c.passed ? "passed" : "failed"}
            </span>
            <span className="text-muted-foreground">: {c.says}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ErrorNote({ error, className }: { error: StepError; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-md border p-3 text-sm",
        error.ours === true
          ? "border-zinc-300 bg-zinc-50 dark:bg-zinc-900"
          : "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40",
        className,
      )}
    >
      <p className="flex flex-wrap items-center gap-2 font-medium">
        {error.message}
        {error.ours === true ? (
          <Badge variant="outline" className="gap-1">
            <Wrench /> Ours to fix
          </Badge>
        ) : null}
      </p>
      <p>
        <span className="font-medium">What to do: </span>
        {error.todo}
      </p>
      <p className="font-mono text-xs text-muted-foreground">{error.code}</p>
    </div>
  );
}

/** Attempts, model and cost, in one quiet line. */
export function StepMeta({ step }: { step: RunStep }) {
  if (step.status === "not_reached") return null;
  const parts = [
    step.attempts === 1 ? "1 attempt" : `${String(step.attempts)} attempts`,
    step.model === undefined ? null : `${step.role ?? ""} model, ${step.model}`,
    step.cost === 1 ? "1 credit" : `${String(step.cost)} credits`,
    step.ms === 0 ? null : `${(step.ms / 1000).toFixed(1)} s`,
  ].filter((p) => p !== null);
  return <p className="text-xs text-muted-foreground">{parts.join(", ")}</p>;
}

/** A step's output in full, or a note that it's held back. */
export function StepOutput({ step, full }: { step: RunStep; full: boolean }) {
  if (step.output === undefined) return null;
  if (!full) {
    return (
      <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="size-3" /> Output hidden: it&apos;s from a colleague&apos;s mail
      </p>
    );
  }
  return <p className="rounded bg-muted/60 px-2 py-1 text-sm">{step.output}</p>;
}
