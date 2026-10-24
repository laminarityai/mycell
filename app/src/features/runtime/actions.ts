"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runFormAction } from "@/features/orgs/form-action";
import { getWorkflow } from "@/features/workflows/server";
import type { ActionResult } from "@/lib/errors";
import { runHref } from "./lib/runs-table";
import { dryRun, retryRun, startRun } from "./server";
import type { TryItState } from "./types";

const tryInput = z.object({
  workflowId: z.string().min(1),
  connectionId: z.string().min(1),
  sourceRef: z.string().min(1),
});

/**
 * Tries the workflow's working spec on one message, from the workflow page: nothing is
 * written to any app or stored, and the result goes back to the page only.
 */
export async function tryWorkflowAction(
  _previous: TryItState,
  form: FormData,
): Promise<TryItState> {
  return runFormAction(form, tryInput, async (ctx, input) => {
    const workflow = await getWorkflow(ctx, input.workflowId);
    return {
      result: await dryRun(ctx, workflow.workingSpec, {
        connectionId: input.connectionId,
        sourceRef: input.sourceRef,
        workflowId: workflow.id,
      }),
    };
  });
}

const startRunInput = z.object({
  workflowId: z.string().min(1),
  connectionId: z.string().min(1),
  sourceRef: z.string(),
});

/** Runs the workflow's latest version on one message, from the workflow page. */
export async function startRunAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runFormAction(
    form,
    startRunInput,
    async (ctx, { workflowId, connectionId, sourceRef }) => {
      await startRun(ctx, workflowId, connectionId, sourceRef);
    },
    { after: refresh },
  );
}

const retryInput = z.object({ runId: z.string().min(1) });

/** Retries a failed run on the same message, from its page, and opens the retry's page. */
export async function retryRunAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runFormAction(form, retryInput, (ctx, { runId }) => retryRun(ctx, runId), {
    after: ({ runId }) => redirect(runHref(runId)),
  });
}
