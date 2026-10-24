"use client";

// Retry, in a run's summary strip: a new run of the workflow's latest version on the same
// message, whose page it opens. Disabled, saying why, when the caller can't retry the run.
import { RotateCcw } from "lucide-react";
import { useActionState, useId } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { retryRunAction } from "../actions";
import type { RetryCheck } from "../types";

export function RetryForm({ runId, check }: { runId: string; check: RetryCheck }) {
  const [result, retry, retrying] = useActionState(retryRunAction, {});
  const whyId = useId();
  return (
    <form action={retry} className="ml-auto flex max-w-64 flex-col items-end gap-1 text-right">
      <input type="hidden" name="runId" value={runId} />
      <Button
        type="submit"
        variant="outline"
        disabled={!check.allowed || retrying}
        aria-describedby={check.allowed ? undefined : whyId}
      >
        <RotateCcw aria-hidden /> Retry
      </Button>
      {check.allowed ? null : (
        <p id={whyId} className="text-xs text-muted-foreground">
          {check.why}
        </p>
      )}
      <FormError message={result.error} />
    </form>
  );
}
