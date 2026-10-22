// The held-send adapter (ADR-0020): where an app can't hold a waiting write, Mycel holds its
// request, encrypted with the company's key, until a person ends its review. Approving sends it
// once through the proxy (with the person's edits to its editable text, in memory only), then
// deletes it; declining deletes it. A held send can't be finished in its app, so it is waiting
// while it exists and gone once it doesn't.
import { z } from "zod";
import { proxyPatch, proxyPost, proxyPut } from "@/features/connections/server";
import {
  customActionOf,
  renderRequest,
  type RenderedRequest,
} from "@/features/custom-actions/description";
import { listCustomActions } from "@/features/custom-actions/server";
import type { StoredCustomAction } from "@/features/custom-actions/types";
import type { Ctx } from "@/lib/ctx";
import { SourceRequestError } from "@/features/connections/types";
import {
  ForbiddenError,
  ItemGoneError,
  NotFoundError,
  SendUnconfirmedError,
  ValidationError,
} from "@/lib/errors";
import {
  deleteHeldSend,
  deleteHeldSendsBefore,
  findHeldSend,
  heldSendExists,
  holdRequest,
  putBackHeldSend,
  takeHeldSend,
  type HeldRequest,
  type HeldSend,
} from "./held-sends";
import type { PendingFormAdapter, PendingItem, ReviewEdits } from "./pending-forms";

/** What a run's custom write hands `prepare`: its request, and where it would be sent. */
export type HeldSendInput = {
  /** The run owner's connection to the custom action's app. */
  connectionId: string;
  runId: string;
  stepId: string;
  customAction: string;
  held: HeldRequest;
};

export const heldSendAdapter: PendingFormAdapter<HeldSendInput> = {
  // Stores the request, encrypted; its ID is the review's item ref, and its own thread.
  async prepare(ctx, { held, ...send }) {
    const id = await holdRequest(ctx, send, held);
    return { itemRef: id, threadRef: id };
  },

  // Takes the request out of storage, then sends it once, as held or with the person's edits,
  // from memory. The app answering that what it was sent to isn't there ends it gone. A refusal
  // before the request reached the app puts it back to wait again; any other failure may have
  // reached the app, so it stays taken and is never sent again (SendUnconfirmedError).
  async approve(ctx, item, edits) {
    const send = await heldSendOf(ctx, item);
    const record = await actionOf(ctx, send);
    const request = edits === undefined ? send.held.request : edited(record, send, edits);
    const taken = await takeHeldSend(ctx, send.id);
    if (taken === undefined) throw new ItemGoneError();
    let answer: unknown;
    try {
      answer = await sent(ctx, send.connectionId, request);
    } catch (error) {
      if (!neverReachedApp(error)) throw new SendUnconfirmedError();
      await putBackHeldSend(ctx, taken);
      throw error;
    }
    if (answer === null) throw new ItemGoneError();
  },

  async decline(ctx, item) {
    if (!(await deleteHeldSend(ctx, item.itemRef))) throw new ItemGoneError();
  },

  async check(ctx, item) {
    return (await heldSendExists(ctx, item.itemRef)) ? "waiting" : "gone";
  },

  // The app, the action and each input it sends, with which of them the person may edit: those
  // last, as the text the person reads before deciding.
  async view(ctx, item) {
    const send = await heldSendOf(ctx, item);
    const record = await actionOf(ctx, send);
    const action = customActionOf(record);
    const fields = Object.entries(record.inputs).flatMap(([name, input]) => {
      if (!Object.hasOwn(send.held.input, name)) return [];
      const value = send.held.input[name];
      const editable = record.editable.includes(name);
      return [{ name, description: input.description, value: String(value), editable }];
    });
    return {
      kind: "held_send",
      app: action.app,
      action: record.name,
      description: record.description,
      method: send.held.request.method,
      url: send.held.request.url,
      fields: [...fields.filter((f) => !f.editable), ...fields.filter((f) => f.editable)],
    };
  },

  // Nothing is held for more than `before` allows.
  async purge(ctx, before) {
    await deleteHeldSendsBefore(ctx, before);
  },
};

async function heldSendOf(ctx: Ctx, item: PendingItem): Promise<HeldSend> {
  const send = await findHeldSend(ctx, item.itemRef);
  if (send?.connectionId !== item.connectionId) throw new ItemGoneError();
  return send;
}

// The custom action it calls, which never changes once accepted.
async function actionOf(ctx: Ctx, send: HeldSend): Promise<StoredCustomAction> {
  const record = (await listCustomActions(ctx)).find((stored) => stored.name === send.customAction);
  if (record === undefined) throw new ItemGoneError();
  return record;
}

/**
 * The request rendered again with the person's edits to its editable text inputs, in memory
 * only. ValidationError for an edit to anything else, or one its input refuses.
 */
function edited(record: StoredCustomAction, send: HeldSend, edits: ReviewEdits): RenderedRequest {
  if (!("fields" in edits)) throw new ValidationError("Edit the request's fields to send it.");
  for (const [name, value] of Object.entries(edits.fields)) {
    if (!record.editable.includes(name)) throw new ValidationError(`"${name}" can't be edited.`);
    if (value.trim() === "") throw new ValidationError(`Write the ${name} before sending it.`);
  }
  const action = customActionOf(record);
  const input = action.input.safeParse({ ...send.held.input, ...edits.fields });
  const request = input.success ? renderRequest(action, input.data as never) : undefined;
  if (request === undefined) throw new ValidationError("The edited request can't be sent.");
  return request;
}

const answer = z.unknown();

/**
 * Whether a failed send certainly never reached the app: the connection was gone or not the
 * caller's, or the app or Nango refused it outright (a 4xx other than a timeout). A 5xx, a
 * timeout or a dropped connection may have come after the app carried the request out.
 */
function neverReachedApp(error: unknown): boolean {
  if (error instanceof NotFoundError || error instanceof ForbiddenError) return true;
  if (!(error instanceof SourceRequestError)) return false;
  return error.status >= 400 && error.status < 500 && error.status !== 408;
}

// Sends a write's request through the proxy; null when the app had no such item (404 or 410).
function sent(ctx: Ctx, connectionId: string, request: RenderedRequest): Promise<unknown> {
  const body = request.body ?? {};
  switch (request.method) {
    case "POST":
      return proxyPost(ctx, connectionId, request.path, body, answer);
    case "PUT":
      return proxyPut(ctx, connectionId, request.path, body, answer);
    case "PATCH":
      return proxyPatch(ctx, connectionId, request.path, body, answer);
    case "GET":
      throw new ValidationError("A held send is a write.");
  }
}
