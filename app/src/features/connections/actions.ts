"use server";

import { getCtx } from "@/features/orgs/server";
import { actionError } from "@/lib/errors";
import { startConnect } from "./server";
import { sourceSchema } from "./types";

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
