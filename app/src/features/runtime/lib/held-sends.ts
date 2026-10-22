// Held sends' storage (ADR-0020): the request a custom write would make, and the inputs it was
// rendered from, encrypted with the company's own key (ADR-0024) and kept only until its review
// ends. Only the held-send adapter and the run step that holds one use it. The request is
// decrypted in memory, only to show or send it.
import { randomUUID } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { forOrg } from "@/db/for-org";
import type { CustomValue, RenderedRequest } from "@/features/custom-actions/description";
import { decryptForOrg, encryptForOrg } from "@/features/key-store/server";
import type { Ctx } from "@/lib/ctx";
import { heldSends } from "./schema";

/** What a held send holds: the rendered request, and the checked inputs it was rendered from. */
export type HeldRequest = {
  request: RenderedRequest;
  input: Record<string, CustomValue>;
};

const heldRequestSchema = z.object({
  request: z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH"]),
    path: z.string(),
    url: z.string(),
    body: z.record(z.string(), z.unknown()).optional(),
  }),
  input: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

/** A held send as its adapter reads it: where it goes, and its request, decrypted. */
export type HeldSend = {
  id: string;
  connectionId: string;
  customAction: string;
  createdAt: Date;
  held: HeldRequest;
};

/**
 * Holds `held` for the run step `runId`/`stepId`, to be sent through `connectionId`: the one
 * held send of that step, however often the step is retried. Returns its ID.
 */
export async function holdRequest(
  ctx: Ctx,
  send: { connectionId: string; runId: string; stepId: string; customAction: string },
  held: HeldRequest,
): Promise<string> {
  const db = forOrg(ctx);
  const ofStep = and(eq(heldSends.runId, send.runId), eq(heldSends.stepId, send.stepId));
  const earlier = (await db.select(heldSends, { where: ofStep })).at(0);
  if (earlier !== undefined) return earlier.id;
  const request = await encryptForOrg(ctx, JSON.stringify(held));
  await db.insert(heldSends, { id: randomUUID(), ...send, request }, { onConflictDoNothing: true });
  const row = (await db.select(heldSends, { where: ofStep })).at(0);
  if (row === undefined) throw new Error("The held send wasn't stored.");
  return row.id;
}

/** The held send, decrypted; undefined once it's gone (sent, declined, expired). */
export async function findHeldSend(ctx: Ctx, id: string): Promise<HeldSend | undefined> {
  const row = (await forOrg(ctx).select(heldSends, { where: eq(heldSends.id, id) })).at(0);
  if (row === undefined) return undefined;
  const { request, input } = heldRequestSchema.parse(
    JSON.parse(await decryptForOrg(ctx, row.request)),
  );
  return {
    id: row.id,
    connectionId: row.connectionId,
    customAction: row.customAction,
    createdAt: row.createdAt,
    held: { request: { ...request, body: request.body }, input },
  };
}

/** Whether the held send is still there, without decrypting it. */
export async function heldSendExists(ctx: Ctx, id: string): Promise<boolean> {
  return (await forOrg(ctx).select(heldSends, { where: eq(heldSends.id, id) })).length > 0;
}

/** Deletes the held send; false when it was already gone. */
export async function deleteHeldSend(ctx: Ctx, id: string): Promise<boolean> {
  return (await forOrg(ctx).delete(heldSends, eq(heldSends.id, id))).length > 0;
}

/**
 * Deletes every held send made before `before`, its review ended or not: the most Mycel holds
 * one is 30 days, and one whose run stopped before its approval step has no review to end it.
 */
export async function deleteHeldSendsBefore(ctx: Ctx, before: Date): Promise<number> {
  return (await forOrg(ctx).delete(heldSends, lt(heldSends.createdAt, before))).length;
}
