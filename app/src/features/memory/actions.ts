"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getCtx } from "@/features/orgs/server";
import type { Ctx } from "@/lib/ctx";
import { actionError, type ActionResult } from "@/lib/errors";
import { grantStaffConsent, revokeStaffConsent } from "./server";

const grantInput = z.object({ staffEmail: z.string(), reason: z.string(), days: z.string() });
const revokeInput = z.object({ consentId: z.string().min(1) });

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
