"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getCtx } from "@/features/orgs/server";
import { actionError, type ActionResult } from "@/lib/errors";
import { disconnect, startConnect } from "./server";
import { sourceSchema } from "./types";

const disconnectInput = z.object({ connectionId: z.string().min(1) });

/** Starts a connect attempt and hands the browser the token Nango's Connect UI opens with. */
export async function startConnectAction(
  source: unknown,
): Promise<{ token: string } | { error: string }> {
  const ctx = await getCtx();
  const parsed = sourceSchema.parse(source);
  try {
    return await startConnect(ctx, parsed);
  } catch (error) {
    return { error: actionError(error).error ?? "Couldn't start connecting. Try again." };
  }
}

export async function disconnectAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  const ctx = await getCtx();
  const input = disconnectInput.parse(Object.fromEntries(form));
  try {
    await disconnect(ctx, input.connectionId);
  } catch (error) {
    return actionError(error);
  }
  refresh();
  return {};
}
