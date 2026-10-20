"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getCtx } from "@/features/orgs/server";
import { actionError, type ActionResult } from "@/lib/errors";
import { disconnect, startConnect, startReconnect } from "./server";
import { connectionKindSchema } from "./types";

const disconnectInput = z.object({ connectionId: z.string().min(1) });

/**
 * Starts connecting a Google account (ADR-0014) and hands the browser the token Nango's
 * Connect UI opens with.
 */
export async function startConnectAction(
  kind: unknown,
): Promise<{ token: string } | { error: string }> {
  const ctx = await getCtx();
  const parsedKind = connectionKindSchema.parse(kind);
  try {
    return await startConnect(ctx, "google", parsedKind);
  } catch (error) {
    return { error: actionError(error).error ?? "Couldn't start connecting. Try again." };
  }
}

/** Starts reconnecting a connection and hands the browser the token Connect UI opens with. */
export async function startReconnectAction(
  connectionId: unknown,
): Promise<{ token: string } | { error: string }> {
  const ctx = await getCtx();
  const id = disconnectInput.shape.connectionId.parse(connectionId);
  try {
    return await startReconnect(ctx, id);
  } catch (error) {
    return { error: actionError(error).error ?? "Couldn't start reconnecting. Try again." };
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
