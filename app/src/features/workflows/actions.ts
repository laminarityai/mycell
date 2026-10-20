"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCtx } from "@/features/orgs/server";
import { actionError, type ActionResult } from "@/lib/errors";
import { publishWorkflow, saveWorkflow } from "./server";

const saveInput = z.object({
  workflowId: z.string().min(1).optional(),
  name: z.string(),
  spec: z.string(),
});
const publishInput = z.object({ workflowId: z.string().min(1) });

/** Saves the pasted spec. A new workflow goes to its own page; an edit refreshes this one. */
export async function saveWorkflowAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const ctx = await getCtx();
  const input = saveInput.parse(Object.fromEntries(form));
  let spec: unknown;
  try {
    spec = JSON.parse(input.spec);
  } catch {
    return {
      error: "The spec isn't valid JSON.",
      issues: [{ path: [], message: "Check for a missing comma, quote or bracket." }],
    };
  }
  let id: string;
  try {
    ({ id } = await saveWorkflow(ctx, { workflowId: input.workflowId, name: input.name, spec }));
  } catch (error) {
    return actionError(error);
  }
  if (input.workflowId === undefined) redirect(`/workflows/${id}`);
  refresh();
  return {};
}

export async function publishWorkflowAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const ctx = await getCtx();
  const { workflowId } = publishInput.parse(Object.fromEntries(form));
  try {
    await publishWorkflow(ctx, workflowId);
  } catch (error) {
    return actionError(error);
  }
  refresh();
  return {};
}
