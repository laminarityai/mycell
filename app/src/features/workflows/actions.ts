"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runFormAction, runValueAction } from "@/features/orgs/form-action";
import { SpecInvalidError, type ActionResult } from "@/lib/errors";
import {
  archiveWorkflow,
  disable,
  enable,
  publishWorkflow,
  restoreWorkflow,
  saveWorkflow,
  switchWorkflowOff,
  switchWorkflowOn,
} from "./server";
import type { EnableResult } from "./types";

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
  return runFormAction(
    form,
    saveInput,
    async (ctx, { spec, ...input }) => {
      const { id } = await saveWorkflow(ctx, { ...input, spec: readSpecText(spec) });
      return { id, created: input.workflowId === undefined };
    },
    {
      after: ({ id, created }) => {
        if (created) redirect(`/workflows/${id}`);
        refresh();
      },
    },
  );
}

/** The spec field's JSON, or SpecInvalidError saying it isn't JSON. */
function readSpecText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new SpecInvalidError(
      [{ path: [], message: "Check for a missing comma, quote or bracket." }],
      "The spec isn't valid JSON.",
    );
  }
}

export async function switchWorkflowOnAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runFormAction(
    form,
    switchOnInput,
    (ctx, { workflowId, connectionId }) => switchWorkflowOn(ctx, workflowId, connectionId),
    { after: refresh },
  );
}

export async function switchWorkflowOffAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runFormAction(
    form,
    workflowForm,
    (ctx, { workflowId }) => switchWorkflowOff(ctx, workflowId),
    { after: refresh },
  );
}

/** Archives a workflow: it stops everywhere and members no longer see it. */
export async function archiveWorkflowAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runFormAction(
    form,
    workflowForm,
    (ctx, { workflowId }) => archiveWorkflow(ctx, workflowId),
    { after: refresh },
  );
}

/** Restores an archived workflow, with everyone's switches as they were. */
export async function restoreWorkflowAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runFormAction(
    form,
    workflowForm,
    (ctx, { workflowId }) => restoreWorkflow(ctx, workflowId),
    { after: refresh },
  );
}

/**
 * Switches a workflow on for the caller's own Google connection. When the connection is missing
 * or short of an app, it says so instead, and the page sends the member through connecting or
 * reconnecting, then calls this again.
 */
export async function enableWorkflowAction(
  workflowId: unknown,
): Promise<EnableResult | ActionResult> {
  return runValueAction(workflowId, workflowIdInput, enable, {
    after: (result) => {
      if ("enabled" in result) refresh();
      return result;
    },
  });
}

/** Switches the caller's enablement of a workflow off. */
export async function disableWorkflowAction(workflowId: unknown): Promise<ActionResult> {
  return runValueAction(workflowId, workflowIdInput, disable, { after: refresh });
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
  return runFormAction(
    form,
    publishForm,
    async (ctx, { workflowId, settings }) => {
      await publishWorkflow(ctx, workflowId, settings);
    },
    { lists: ["tag"], after: refresh },
  );
}
