"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getCtx } from "@/features/orgs/server";
import type { Ctx } from "@/lib/ctx";
import { actionError, type ActionResult } from "@/lib/errors";
import { addExclusion, removeExclusion, setMemoryBudget, startMemory } from "./server";
import { EXCLUSION_KINDS } from "./types";

// The server functions parse the values themselves; the forms only have to carry them.
const budgetInput = z.object({ monthlyBudget: z.string() });
const exclusionInput = z.object({ kind: z.enum(EXCLUSION_KINDS), value: z.string() });
const removalInput = z.object({ exclusionId: z.string().min(1) });

export async function startMemoryAction(_previous: ActionResult, form: FormData) {
  return run(form, budgetInput, (ctx, input) => startMemory(ctx, input));
}

export async function setMemoryBudgetAction(_previous: ActionResult, form: FormData) {
  return run(form, budgetInput, (ctx, input) => setMemoryBudget(ctx, input));
}

export async function addExclusionAction(_previous: ActionResult, form: FormData) {
  return run(form, exclusionInput, (ctx, input) => addExclusion(ctx, input));
}

export async function removeExclusionAction(_previous: ActionResult, form: FormData) {
  return run(form, removalInput, (ctx, { exclusionId }) => removeExclusion(ctx, exclusionId));
}

// Every memory action has the same shape: parse the form, run one server function as the
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
