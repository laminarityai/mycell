"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { runFormAction } from "@/features/orgs/form-action";
import type { ActionResult } from "@/lib/errors";
import { assignTag, createTag, deleteTag, renameTag, unassignTag } from "./server";

const id = z.string().min(1);
const nameInput = z.object({ name: z.string() });
const renameInput = z.object({ tagId: id, name: z.string() });
const tagInput = z.object({ tagId: id });
const assignmentInput = z.object({ tagId: id, userId: id });

export async function createTagAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runFormAction(
    form,
    nameInput,
    async (ctx, { name }) => {
      await createTag(ctx, name);
    },
    { after: refresh },
  );
}

export async function renameTagAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runFormAction(form, renameInput, (ctx, { tagId, name }) => renameTag(ctx, tagId, name), {
    after: refresh,
  });
}

export async function deleteTagAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runFormAction(form, tagInput, (ctx, { tagId }) => deleteTag(ctx, tagId), {
    after: refresh,
  });
}

export async function assignTagAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runFormAction(
    form,
    assignmentInput,
    (ctx, { tagId, userId }) => assignTag(ctx, tagId, userId),
    { after: refresh },
  );
}

export async function unassignTagAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runFormAction(
    form,
    assignmentInput,
    (ctx, { tagId, userId }) => unassignTag(ctx, tagId, userId),
    { after: refresh },
  );
}
