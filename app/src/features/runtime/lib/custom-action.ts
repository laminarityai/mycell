// The one generic executor for every custom action (ADR-0018): it fills the call's path and
// query from the step's checked input, sends it only to the registered app's hosts through the
// run owner's connection to that app, and picks the typed result fields out of the response.
// The response itself goes no further than this function. Custom writes wait for held sends
// (#98), so only a GET is sent.
import { z } from "zod";
import { connectionToApp, proxyGet } from "@/features/connections/server";
import { registeredAppIdSchema } from "@/features/connections/types";
import {
  pickOutputs,
  renderRequest,
  type CustomValue,
} from "@/features/custom-actions/description";
import type { CustomAction } from "@/features/policy/types";
import type { Ctx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { RunStepError } from "./failures";

/** Runs `action` with its checked `input` for a run on `runConnectionId`; its fields, unchecked. */
export async function runCustomAction(
  ctx: Ctx,
  runConnectionId: string,
  action: CustomAction,
  input: Readonly<Record<string, CustomValue | undefined>>,
): Promise<Record<string, unknown>> {
  const app = registeredAppIdSchema.parse(action.registeredApp);
  const notConnected = new RunStepError(
    "app_not_connected",
    `The run's account has no ${action.app} connection to call it through.`,
  );
  const connectionId = await connectionToApp(ctx, runConnectionId, app);
  if (connectionId === undefined) throw notConnected;
  const request = renderRequest(action, input);
  if (request === undefined) {
    throw new RunStepError(
      "invalid_input",
      `The call ${action.name} makes would leave ${action.app}'s hosts, so it wasn't sent.`,
    );
  }
  if (request.method !== "GET") {
    throw new RunStepError(
      "not_available",
      `${action.name} writes, and custom writes aren't available yet.`,
    );
  }
  let response: unknown;
  try {
    response = await proxyGet(ctx, connectionId, request.path, z.unknown());
  } catch (error) {
    // The app's connection went, not the run's.
    if (error instanceof NotFoundError && connectionId !== runConnectionId) throw notConnected;
    throw error;
  }
  if (response === null) {
    throw new RunStepError(
      "source_item_missing",
      `${action.app} has no such item for ${action.name}.`,
    );
  }
  return pickOutputs(action, response);
}
