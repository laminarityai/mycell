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
import {
  capabilityRequestInputSchema,
  type CapabilityRequest,
  type CapabilityRequestInput,
  type CapabilityRequestStatus,
  type FiledCapabilityRequest,
} from "../types";
import { capabilityRequestAsks, capabilityRequests } from "./schema";

type RequestRow = typeof capabilityRequests.$inferSelect;
type AskRow = typeof capabilityRequestAsks.$inferSelect;

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
      const count = (
        await tx.select(capabilityRequestAsks, {
          where: eq(capabilityRequestAsks.requestId, row.id),
        })
      ).length;
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
  const asks = await forOrg(ctx).select(capabilityRequestAsks, {
    where: inArray(
      capabilityRequestAsks.requestId,
      rows.map((row) => row.id),
    ),
    orderBy: [asc(capabilityRequestAsks.createdAt), asc(capabilityRequestAsks.id)],
  });
  return rows.map((row) => toRequest(row, asks));
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

function filedMessage(count: number, row: RequestRow): string {
  return count === 1
    ? "Filed: our team will see it. Tell the admin plainly what you can't do yet."
    : `This was asked for ${String(count)} times now, and its status is ${row.status}. ` +
        "Tell the admin plainly what you can't do yet.";
}

function toRequest(row: RequestRow, asks: AskRow[]): CapabilityRequest {
  const own = asks.filter((ask) => ask.requestId === row.id);
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
    count: own.length,
    conversationIds: [...new Set(own.map((ask) => ask.conversationId))],
    status: row.status,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
