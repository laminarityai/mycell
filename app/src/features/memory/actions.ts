"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getCtx } from "@/features/orgs/server";
import type { Ctx } from "@/lib/ctx";
import { actionError, type ActionResult } from "@/lib/errors";
import {
  addExclusion,
  grantStaffConsent,
  removeExclusion,
  revokeStaffConsent,
  setMemoryBudget,
  startMemory,
} from "./server";
import { EXCLUSION_KINDS } from "./types";

const grantInput = z.object({ staffEmail: z.string(), reason: z.string(), days: z.string() });
const revokeInput = z.object({ consentId: z.string().min(1) });
// The server functions parse these values themselves; the forms only have to carry them.
const budgetInput = z.object({ monthlyBudget: z.string() });
const exclusionInput = z.object({ kind: z.enum(EXCLUSION_KINDS), value: z.string() });
const removalInput = z.object({ exclusionId: z.string().min(1) });

/** An admin confirms the estimate and starts memory with a monthly budget. */
export async function startMemoryAction(_previous: ActionResult, form: FormData) {
  return run(form, budgetInput, (ctx, input) => startMemory(ctx, input));
}

/** An admin changes memory's monthly budget. */
export async function setMemoryBudgetAction(_previous: ActionResult, form: FormData) {
  return run(form, budgetInput, (ctx, input) => setMemoryBudget(ctx, input));
}

/** An admin keeps a label, folder, address or domain out of memory. */
export async function addExclusionAction(_previous: ActionResult, form: FormData) {
  return run(form, exclusionInput, (ctx, input) => addExclusion(ctx, input));
}

/** An admin removes an exclusion. */
export async function removeExclusionAction(_previous: ActionResult, form: FormData) {
  return run(form, removalInput, (ctx, { exclusionId }) => removeExclusion(ctx, exclusionId));
}

/** An admin lets one of our staff read memory for one case. */
export async function grantStaffConsentAction(_previous: ActionResult, form: FormData) {
  return run(form, grantInput, (ctx, { staffEmail, reason, days }) =>
    grantStaffConsent(ctx, { staffEmail, reason, days: Number(days) }),
  );
}

/** An admin ends a staff consent at once. */
export async function revokeStaffConsentAction(_previous: ActionResult, form: FormData) {
  return run(form, revokeInput, (ctx, { consentId }) => revokeStaffConsent(ctx, consentId));
}

// Parse the form, run one server function as the signed-in user, then refresh the page or
// return the typed error's message.
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
