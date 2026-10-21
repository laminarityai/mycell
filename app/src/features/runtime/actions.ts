"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getCtx } from "@/features/orgs/server";
import { getWorkflow } from "@/features/workflows/server";
import { actionError, type ActionResult } from "@/lib/errors";
import { parseForm } from "@/lib/forms";
import { dryRun, startRun } from "./server";
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
  const ctx = await getCtx();
  try {
    const input = parseForm(tryInput, form);
    const workflow = await getWorkflow(ctx, input.workflowId);
    return {
      result: await dryRun(ctx, workflow.workingSpec, {
        connectionId: input.connectionId,
        sourceRef: input.sourceRef,
        workflowId: workflow.id,
      }),
    };
  } catch (error) {
    return actionError(error);
  }
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
  const ctx = await getCtx();
  try {
    const input = parseForm(startRunInput, form);
    await startRun(ctx, input.workflowId, input.connectionId, input.sourceRef);
  } catch (error) {
    return actionError(error);
  }
  refresh();
  return {};
}
