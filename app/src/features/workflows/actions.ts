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
const workflowIdInput = z.string().min(1);
/** A form about one workflow: its switch off, archive or restore. */
const workflowForm = z.object({ workflowId: workflowIdInput });
const switchOnInput = z.object({ workflowId: workflowIdInput, connectionId: z.string().min(1) });
/**
 * Publish's form. The dialog sends `chooseTags`, a `tag` field per ticked tag and the `handoff`
 * switch (sent only when on), which become the version's settings; a bare publish (the
 * builder's) sends the workflow alone and keeps the working spec's.
 */
const publishForm = z
  .object({
    workflowId: workflowIdInput,
    chooseTags: z.literal("1").optional(),
    tag: z.array(z.string().min(1)),
    handoff: z.literal("on").optional(),
  })
  .transform(({ workflowId, chooseTags, tag, handoff }) => ({
    workflowId,
    settings: chooseTags === undefined ? {} : { tags: tag, handoff: handoff === "on" },
  }));

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
    const { workflowId } = parseForm(workflowForm, form);
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
    await archiveWorkflow(ctx, parseForm(workflowForm, form).workflowId);
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
    await restoreWorkflow(ctx, parseForm(workflowForm, form).workflowId);
  } catch (error) {
    return actionError(error);
  }
  refresh();
  return {};
}

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
    const { workflowId, settings } = parseForm(publishForm, form, ["tag"]);
    await publishWorkflow(ctx, workflowId, settings);
  } catch (error) {
    return actionError(error);
  }
  refresh();
  return {};
}
