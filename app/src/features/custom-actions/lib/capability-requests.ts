// Capability requests (ADR-0018): when one call can't do what an admin described, the builder
// chat files a structured ask, with code it drafts, for our team to review into the catalog.
// A request is unique per org on its app and operation; asking again adds an ask, which raises
// its count and names one more builder conversation. Admins of the org read them; only our
// team, acting as the system ctx (ADR-0009), changes a status.
import { randomUUID } from "node:crypto";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { isForeignKeyViolation } from "@/db/errors";
import { forOrg } from "@/db/for-org";
import { REGISTERED_APPS, registeredApps } from "@/features/connections/registered-apps";
import { registeredAppIdSchema } from "@/features/connections/types";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import { ForbiddenError, InvariantError, NotFoundError, ValidationError } from "@/lib/errors";
import type { PromptText } from "@/lib/prompts";
import {
  capabilityRequestInputSchema,
  type CapabilityRequest,
  type CapabilityRequestInput,
  type CapabilityRequestStatus,
  type FiledCapabilityRequest,
} from "../types";
import { capabilityRequestPrompts } from "./prompts";
import { capabilityRequestAsks, capabilityRequests } from "./schema";

type RequestRow = typeof capabilityRequests.$inferSelect;

/**
 * Files a capability request from a builder conversation, or adds an ask to the org's request
 * for the same app and operation. The request's details become this ask's, keeping the earlier
 * code draft when this one has none. Admin-only, like the builder chat.
 */
export async function fileCapabilityRequest(
  ctx: Ctx,
  input: CapabilityRequestInput,
  from: { conversationId: string },
): Promise<FiledCapabilityRequest> {
  requireAdmin(ctx);
  const parsed = capabilityRequestInputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("That capability request isn't complete.");
  const request = parsed.data;
  const app = appOf(request.app);
  const operation = collapse(request.operation);
  const key = `${app.toLowerCase()}\n${operation.toLowerCase()}`;
  try {
    return await forOrg(ctx).transaction(async (tx) => {
      const details = {
        operation,
        inputs: request.inputs,
        outputs: request.outputs,
        reason: request.reason,
      };
      const inserted = await tx.insert(
        capabilityRequests,
        { id: randomUUID(), app, key, ...details, codeDraft: request.codeDraft ?? null },
        { onConflictDoNothing: true },
      );
      // Asked before: the insert skipped the org's request for this key, so update that one.
      const row =
        inserted.at(0) ??
        (
          await tx.update(
            capabilityRequests,
            {
              ...details,
              ...(request.codeDraft === undefined ? {} : { codeDraft: request.codeDraft }),
              updatedAt: new Date(),
            },
            eq(capabilityRequests.key, key),
          )
        ).at(0);
      // One of the two always returns the row, so this is a bug.
      if (row === undefined) throw new InvariantError("The capability request wasn't recorded.");
      await tx.insert(capabilityRequestAsks, {
        id: randomUUID(),
        requestId: row.id,
        conversationId: from.conversationId,
        askedBy: ctx.userId,
      });
      const count = await tx.count(
        capabilityRequestAsks,
        eq(capabilityRequestAsks.requestId, row.id),
      );
      return { requestId: row.id, count, status: row.status, message: filedMessage(count, row) };
    });
  } catch (error) {
    // The conversation names one in the caller's org, or none at all.
    if (isForeignKeyViolation(error, "capability_request_asks_conversation_fk")) {
      throw new NotFoundError("builder conversation");
    }
    throw error;
  }
}

/** The org's capability requests, most recently changed first. Admins, and our team's script. */
export async function listCapabilityRequests(ctx: Ctx): Promise<CapabilityRequest[]> {
  if (ctx.role !== "system") requireAdmin(ctx);
  const rows = await forOrg(ctx).select(capabilityRequests, {
    orderBy: [desc(capabilityRequests.updatedAt), desc(capabilityRequests.id)],
  });
  if (rows.length === 0) return [];
  const asks = capabilityRequestAsks;
  const ofRequests = inArray(
    asks.requestId,
    rows.map((row) => row.id),
  );
  const [counts, firstAsks] = await Promise.all([
    forOrg(ctx).countBy(asks, { requestId: asks.requestId }, ofRequests),
    // Each conversation a request was asked in, once: its first ask there.
    forOrg(ctx).select(asks, {
      columns: ["requestId", "conversationId", "createdAt", "id"],
      where: ofRequests,
      distinctOn: [asks.requestId, asks.conversationId],
      orderBy: [asc(asks.requestId), asc(asks.conversationId), asc(asks.createdAt), asc(asks.id)],
    }),
  ]);
  const countOf = new Map(counts.map((group) => [group.requestId, group.count]));
  // Oldest first, as the conversations were first asked in.
  const asked = firstAsks.toSorted(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  return rows.map((row) =>
    toRequest(row, {
      count: countOf.get(row.id) ?? 0,
      conversationIds: asked
        .filter((ask) => ask.requestId === row.id)
        .map((ask) => ask.conversationId),
    }),
  );
}

/**
 * Changes a request's status, with our team's note for the org's admins (none clears it). Only
 * our team's script, acting as the system ctx, may: admins and members get ForbiddenError.
 */
export async function setCapabilityRequestStatus(
  ctx: Ctx,
  requestId: string,
  change: { status: CapabilityRequestStatus; note?: string },
): Promise<void> {
  if (ctx.role !== "system") throw new ForbiddenError();
  const note = change.note?.trim();
  const updated = await forOrg(ctx).update(
    capabilityRequests,
    {
      status: change.status,
      note: note === undefined || note === "" ? null : note,
      updatedAt: new Date(),
    },
    eq(capabilityRequests.id, requestId),
  );
  if (updated.length === 0) throw new NotFoundError("capability request");
}

/** A registered app's ID when the agent named one by ID or name; otherwise the name it gave. */
function appOf(named: string): string {
  const name = collapse(named);
  const registered = registeredApps.find(
    (app) =>
      app.id.toLowerCase() === name.toLowerCase() || app.name.toLowerCase() === name.toLowerCase(),
  );
  return registered?.id ?? name;
}

function collapse(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function filedMessage(count: number, row: RequestRow): PromptText {
  return count === 1
    ? capabilityRequestPrompts.filed()
    : capabilityRequestPrompts.askedAgain({ count: String(count), status: row.status });
}

function toRequest(
  row: RequestRow,
  { count, conversationIds }: { count: number; conversationIds: string[] },
): CapabilityRequest {
  const registered = registeredAppIdSchema.safeParse(row.app);
  return {
    id: row.id,
    app: registered.success
      ? { id: registered.data, name: REGISTERED_APPS[registered.data].name }
      : { id: null, name: row.app },
    operation: row.operation,
    inputs: row.inputs,
    outputs: row.outputs,
    reason: row.reason,
    codeDraft: row.codeDraft,
    count,
    conversationIds,
    status: row.status,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
