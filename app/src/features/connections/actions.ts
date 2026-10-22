"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { runFormAction, runValueAction } from "@/features/orgs/form-action";
import type { ActionResult } from "@/lib/errors";
import { disconnect, startConnect, startReconnect } from "./server";
import { connectionKindSchema, registeredAppIdSchema } from "./types";

const connectInput = z.object({ app: registeredAppIdSchema, kind: connectionKindSchema });
const connectionId = z.string().min(1);
const disconnectInput = z.object({ connectionId });

/** A Connect UI session's token, or why it couldn't start. */
type ConnectSession = Promise<{ token: string } | ActionResult>;

/**
 * Starts connecting an account in a registered app (one Google account, ADR-0014) and hands
 * the browser the token Nango's Connect UI opens with.
 */
export async function startConnectAction(app: unknown, kind: unknown): ConnectSession {
  return runValueAction({ app, kind }, connectInput, (ctx, input) =>
    startConnect(ctx, input.app, input.kind),
  );
}

/** Starts reconnecting a connection and hands the browser the token Connect UI opens with. */
export async function startReconnectAction(id: unknown): ConnectSession {
  return runValueAction(id, connectionId, (ctx, input) => startReconnect(ctx, input));
}

export async function disconnectAction(
  _previous: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runFormAction(form, disconnectInput, (ctx, input) => disconnect(ctx, input.connectionId), {
    after: refresh,
  });
}
