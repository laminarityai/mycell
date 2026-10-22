"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getCtx } from "@/features/orgs/server";
import type { Ctx } from "@/lib/ctx";
import { actionError, type ActionResult } from "@/lib/errors";
import {
  addExclusion,
  forgetPerson,
  grantStaffConsent,
  markCompanyWideList,
  removeExclusion,
  revokeStaffConsent,
  setMemoryBudget,
  setRetentionWindow,
  startMemory,
  unmarkCompanyWideList,
} from "./server";
import { EXCLUSION_KINDS } from "./types";

const grantInput = z.object({ staffEmail: z.string(), reason: z.string(), days: z.string() });
const revokeInput = z.object({ consentId: z.string().min(1) });
// The server functions parse these values themselves; the forms only have to carry them.
const budgetInput = z.object({ monthlyBudget: z.string() });
const exclusionInput = z.object({ kind: z.enum(EXCLUSION_KINDS), value: z.string() });
const removalInput = z.object({ exclusionId: z.string().min(1) });
const retentionInput = z.object({ months: z.string() });
const listInput = z.object({ address: z.string() });
const forgetInput = z.object({ email: z.string() });

/** What forgetting a person returns to its form: how many facts went, or the error. */
export type ForgetResult = ActionResult & { facts?: number };

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

/** An admin changes how many months memory keeps what it learned. */
export async function setRetentionWindowAction(_previous: ActionResult, form: FormData) {
  return run(form, retentionInput, (ctx, input) => setRetentionWindow(ctx, input));
}

/** An admin marks a group address company-wide. */
export async function markCompanyWideListAction(_previous: ActionResult, form: FormData) {
  return run(form, listInput, (ctx, { address }) => markCompanyWideList(ctx, address));
}

/** An admin takes the company-wide mark off a group address. */
export async function unmarkCompanyWideListAction(_previous: ActionResult, form: FormData) {
  return run(form, listInput, (ctx, { address }) => unmarkCompanyWideList(ctx, address));
}

/** An admin forgets a person by email address: says only how many facts went. */
export async function forgetPersonAction(
  _previous: ForgetResult,
  form: FormData,
): Promise<ForgetResult> {
  const ctx = await getCtx();
  const input = forgetInput.parse(Object.fromEntries(form));
  let facts: number;
  try {
    ({ facts } = await forgetPerson(ctx, input));
  } catch (error) {
    return actionError(error);
  }
  refresh();
  return { facts };
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
