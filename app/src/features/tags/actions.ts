"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getCtx } from "@/features/orgs/server";
import type { Ctx } from "@/lib/ctx";
import { actionError, type ActionResult } from "@/lib/errors";
import { assignTag, createTag, deleteTag, renameTag, unassignTag } from "./server";

const id = z.string().min(1);
const nameInput = z.object({ name: z.string() });
const renameInput = z.object({ tagId: id, name: z.string() });
const tagInput = z.object({ tagId: id });
const assignmentInput = z.object({ tagId: id, userId: id });

export async function createTagAction(_previous: ActionResult, form: FormData) {
  return run(form, nameInput, (ctx, { name }) => createTag(ctx, name));
}

export async function renameTagAction(_previous: ActionResult, form: FormData) {
  return run(form, renameInput, (ctx, { tagId, name }) => renameTag(ctx, tagId, name));
}

export async function deleteTagAction(_previous: ActionResult, form: FormData) {
  return run(form, tagInput, (ctx, { tagId }) => deleteTag(ctx, tagId));
}

export async function assignTagAction(_previous: ActionResult, form: FormData) {
  return run(form, assignmentInput, (ctx, { tagId, userId }) => assignTag(ctx, tagId, userId));
}

export async function unassignTagAction(_previous: ActionResult, form: FormData) {
  return run(form, assignmentInput, (ctx, { tagId, userId }) => unassignTag(ctx, tagId, userId));
}

// Every tags action has the same shape: parse the form, run one server function as the
// signed-in user, then refresh the page or return the typed error's message.
async function run<T>(
  form: FormData,
  schema: z.ZodType<T>,
  write: (ctx: Ctx, input: T) => Promise<unknown>,
): Promise<ActionResult> {
  const ctx = await getCtx();
  const input = schema.parse(Object.fromEntries(form));
  try {
    await write(ctx, input);
  } catch (error) {
    return actionError(error);
  }
  refresh();
  return {};
}
