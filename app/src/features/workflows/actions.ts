"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCtx } from "@/features/orgs/server";
import { actionError, ValidationError, type ActionResult } from "@/lib/errors";
import { parseForm } from "@/lib/forms";
import {
  archiveWorkflow,
  checkWorkflowSpec,
  disable,
  enable,
  publishWorkflow,
  restoreWorkflow,
  saveWorkflow,
  switchWorkflowOff,
  switchWorkflowOn,
} from "./server";
import type { EnableResult, SpecCheckResult } from "./types";

const saveInput = z.object({
  workflowId: z.string().min(1).optional(),
  name: z.string(),
  spec: z.string(),
  // The working spec's revision the editor opened; left out for a new workflow.
  baseRevision: z.coerce.number().int().positive().optional(),
});
const publishInput = z.object({ workflowId: z.string().min(1) });
const tagNames = z.array(z.string().min(1));

// The publish dialog's ticked tags: one `tag` field each.
function chosenTags(form: FormData): string[] {
  const parsed = tagNames.safeParse(form.getAll("tag"));
  if (!parsed.success) {
    throw new ValidationError("The form was missing something. Reload the page and try again.");
  }
  return parsed.data;
}
const switchOnInput = z.object({ workflowId: z.string().min(1), connectionId: z.string().min(1) });

/**
 * Saves the editor's spec. A new workflow goes to its own page; an edit refreshes this one. An
 * edit saves only over the revision it was opened at: a newer working spec is never overwritten.
 */
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
    ({ id } = await saveWorkflow(ctx, {
      workflowId: input.workflowId,
      name: input.name,
      spec,
      baseRevision: input.baseRevision,
    }));
  } catch (error) {
    return actionError(error);
  }
  if (input.workflowId === undefined) redirect(`/workflows/${id}`);
  refresh();
  return {};
}

/**
 * The editor's live validation: every issue with the spec as it stands, as saving would find
 * them, or what the policy engine makes of it. Saves nothing.
 */
export async function checkWorkflowSpecAction(spec: unknown): Promise<SpecCheckResult> {
  const ctx = await getCtx();
  try {
    const checked = await checkWorkflowSpec(ctx, spec);
    return checked.ok
      ? { issues: [], maxRisk: checked.maxRisk, inserted: checked.inserted }
      : { issues: checked.issues, maxRisk: null, inserted: [] };
  } catch (error) {
    return { ...actionError(error), issues: [], maxRisk: null, inserted: [] };
  }
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

/** Archives a workflow: it stops everywhere and members no longer see it. */
export async function archiveWorkflowAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const ctx = await getCtx();
  try {
    await archiveWorkflow(ctx, parseForm(publishInput, form).workflowId);
  } catch (error) {
    return actionError(error);
  }
  refresh();
  return {};
}

/** Restores an archived workflow, with everyone's switches as they were. */
export async function restoreWorkflowAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const ctx = await getCtx();
  try {
    await restoreWorkflow(ctx, parseForm(publishInput, form).workflowId);
  } catch (error) {
    return actionError(error);
  }
  refresh();
  return {};
}

const workflowIdInput = z.string().min(1);

/**
 * Switches a workflow on for the caller's own Google connection. When the connection is missing
 * or short of an app, it says so instead, and the page sends the member through connecting or
 * reconnecting, then calls this again.
 */
export async function enableWorkflowAction(
  workflowId: unknown,
): Promise<EnableResult | { error: string }> {
  const ctx = await getCtx();
  let result: EnableResult;
  try {
    result = await enable(ctx, parseWorkflowId(workflowId));
  } catch (error) {
    return { error: actionError(error).error ?? "Couldn't switch it on. Try again." };
  }
  if ("enabled" in result) refresh();
  return result;
}

/** Switches the caller's enablement of a workflow off. */
export async function disableWorkflowAction(workflowId: unknown): Promise<ActionResult> {
  const ctx = await getCtx();
  try {
    await disable(ctx, parseWorkflowId(workflowId));
  } catch (error) {
    return actionError(error);
  }
  refresh();
  return {};
}

function parseWorkflowId(workflowId: unknown): string {
  const parsed = workflowIdInput.safeParse(workflowId);
  if (!parsed.success) {
    throw new ValidationError("Something was missing. Reload the page and try again.");
  }
  return parsed.data;
}

/**
 * Publishes the working spec. From the publish dialog (`chooseTags` set), the ticked `tag`
 * fields are the tags it's published to, saved into the working spec; without it (the builder's
 * Publish), the working spec's own tags.
 */
export async function publishWorkflowAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const ctx = await getCtx();
  try {
    const { workflowId } = parseForm(publishInput, form);
    const tags = form.has("chooseTags") ? chosenTags(form) : undefined;
    await publishWorkflow(ctx, workflowId, { tags });
  } catch (error) {
    return actionError(error);
  }
  refresh();
  return {};
}
