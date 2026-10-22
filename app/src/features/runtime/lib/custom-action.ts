// The one generic executor for every custom action (ADR-0018): it fills the call's path, query
// and body from the step's checked input, and reaches only the registered app's hosts, through
// the run owner's connection to that app. A read is sent at once, and its typed result fields
// are picked out of the response, which goes no further than this function. A write is never
// sent by a run: its request is held until a person approves it (ADR-0020), or, in Try it,
// reported as it would be sent.
import { z } from "zod";
import { connectionToApp, proxyGet, proxyPost } from "@/features/connections/server";
import { registeredAppIdSchema } from "@/features/connections/types";
import {
  pickOutputs,
  renderRequest,
  type CustomValue,
  type RenderedRequest,
} from "@/features/custom-actions/description";
import type { CustomAction } from "@/features/policy/types";
import type { Ctx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { RunStepError } from "./failures";
import { heldSendAdapter } from "./held-send-adapter";

export type CustomInput = Readonly<Record<string, CustomValue | undefined>>;

/** What a custom write's step hands on: its held send, and the connection it would go through. */
export type HeldSendOutput = { heldSendId: string; connectionId: string };

/**
 * Holds a custom write instead of sending it: `hold` in a run, a report of the request in Try
 * it. Either way, nothing reaches the app.
 */
export type HoldSend = (
  ctx: Ctx,
  run: { id: string; connectionId: string },
  stepId: string,
  action: CustomAction,
  input: CustomInput,
) => Promise<HeldSendOutput>;

/** Runs the read `action` with its checked `input` for a run on `runConnectionId`. */
export async function runCustomAction(
  ctx: Ctx,
  runConnectionId: string,
  action: CustomAction,
  input: CustomInput,
): Promise<Record<string, unknown>> {
  const { connectionId, request } = await renderCustomCall(ctx, runConnectionId, action, input);
  let response: unknown;
  try {
    // A read is a GET, or a GraphQL query, which is POSTed with its document and variables. No
    // registered app has a GraphQL API yet, so the description check refuses GraphQL for now.
    response =
      request.method === "POST"
        ? await proxyPost(ctx, connectionId, request.path, request.body, z.unknown())
        : await proxyGet(ctx, connectionId, request.path, z.unknown());
  } catch (error) {
    // The app's connection went, not the run's.
    if (error instanceof NotFoundError && connectionId !== runConnectionId) {
      throw notConnected(action);
    }
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

/** A run's custom write: its request, held for its review through the held-send adapter. */
export const holdCustomWrite: HoldSend = async (ctx, run, stepId, action, input) => {
  const { connectionId, request } = await renderCustomCall(ctx, run.connectionId, action, input);
  const { itemRef } = await heldSendAdapter.prepare(ctx, {
    connectionId,
    runId: run.id,
    stepId,
    customAction: action.name,
    held: { request, input: definedInput(input) },
  });
  return { heldSendId: itemRef, connectionId };
};

/**
 * The request `action` makes with `input`, and the run owner's connection to its app that it
 * goes through. RunStepError when there's no such connection, or when the request would leave
 * the app's hosts.
 */
export async function renderCustomCall(
  ctx: Ctx,
  runConnectionId: string,
  action: CustomAction,
  input: CustomInput,
): Promise<{ connectionId: string; request: RenderedRequest }> {
  const app = registeredAppIdSchema.parse(action.registeredApp);
  const connectionId = await connectionToApp(ctx, runConnectionId, app);
  if (connectionId === undefined) throw notConnected(action);
  const request = renderRequest(action, input);
  if (request === undefined) {
    throw new RunStepError(
      "invalid_input",
      `The call ${action.name} makes would leave ${action.app}'s hosts, so it wasn't sent.`,
    );
  }
  return { connectionId, request };
}

function notConnected(action: CustomAction): RunStepError {
  return new RunStepError(
    "app_not_connected",
    `The run's account has no ${action.app} connection to call it through.`,
  );
}

function definedInput(input: CustomInput): Record<string, CustomValue> {
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, CustomValue] => entry[1] !== undefined),
  );
}
