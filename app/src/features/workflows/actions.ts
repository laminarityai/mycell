"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCtx } from "@/features/orgs/server";
import { actionError, type ActionResult } from "@/lib/errors";
import { parseForm } from "@/lib/forms";
import { publishWorkflow, saveWorkflow, switchWorkflowOff, switchWorkflowOn } from "./server";

const saveInput = z.object({
  workflowId: z.string().min(1).optional(),
  name: z.string(),
  spec: z.string(),
});
const publishInput = z.object({ workflowId: z.string().min(1) });
const switchOnInput = z.object({ workflowId: z.string().min(1), connectionId: z.string().min(1) });

/** Saves the pasted spec. A new workflow goes to its own page; an edit refreshes this one. */
export async function saveWorkflowAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const ctx = await getCtx();
  let input: z.infer<typeof saveInput>;
  try {
    input = parseForm(saveInput, form);
  } catch (error) {
    return actionError(error);
  }
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

export async function switchWorkflowOnAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const ctx = await getCtx();
  try {
    const { workflowId, connectionId } = parseForm(switchOnInput, form);
    await switchWorkflowOn(ctx, workflowId, connectionId);
  } catch (error) {
    return actionError(error);
  }
  refresh();
  return {};
}

export async function switchWorkflowOffAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const ctx = await getCtx();
  try {
    const { workflowId } = parseForm(publishInput, form);
    await switchWorkflowOff(ctx, workflowId);
  } catch (error) {
    return actionError(error);
  }
  refresh();
  return {};
}

export async function publishWorkflowAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const ctx = await getCtx();
  try {
    const { workflowId } = parseForm(publishInput, form);
    await publishWorkflow(ctx, workflowId);
  } catch (error) {
    return actionError(error);
  }
  refresh();
  return {};
}
