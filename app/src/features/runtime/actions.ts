"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getCtx } from "@/features/orgs/server";
import { actionError, type ActionResult } from "@/lib/errors";
import { parseForm } from "@/lib/forms";
import { startRun } from "./server";

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
