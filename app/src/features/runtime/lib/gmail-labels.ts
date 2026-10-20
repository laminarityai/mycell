// The add-label action: find the label by name or create it, then put it on the message. Each
// write checks first for what an earlier try already did, so a retry whose first answer was
// lost labels the message once and makes one label.
import { z } from "zod";
import { proxyGet, proxyPost } from "@/features/connections/server";
import { SourceRequestError } from "@/features/connections/types";
import type { Ctx } from "@/lib/ctx";
import { RunStepError } from "./failures";
import { GMAIL, messageRef } from "./gmail";

const labelSchema = z.object({ id: z.string(), name: z.string() });
const labelsSchema = z.object({ labels: z.array(labelSchema).default([]) });

/** Puts the label named `label` on the message, making the label if the mailbox lacks it. */
export async function addLabel(
  ctx: Ctx,
  connectionId: string,
  input: { messageId: string; label: string },
): Promise<{ messageId: string; labelId: string }> {
  const labelId = await labelIdFor(ctx, connectionId, input.label);
  const message = await messageRef(ctx, connectionId, input.messageId);
  if (!message.labelIds.includes(labelId)) {
    const path = `${GMAIL}/messages/${encodeURIComponent(message.id)}/modify`;
    const modified = await proxyPost(
      ctx,
      connectionId,
      path,
      { addLabelIds: [labelId] },
      z.unknown(),
    );
    if (modified === null) throw new RunStepError("source_item_missing", "Gmail has no such item.");
  }
  return { messageId: message.id, labelId };
}

// Gmail's label names are unique regardless of case.
async function labelIdFor(ctx: Ctx, connectionId: string, name: string): Promise<string> {
  const existing = await findLabel(ctx, connectionId, name);
  if (existing !== undefined) return existing.id;
  try {
    const created = await proxyPost(ctx, connectionId, `${GMAIL}/labels`, { name }, labelSchema);
    if (created !== null) return created.id;
  } catch (error) {
    // 409: another writer made it since the listing, so it's there now.
    if (!(error instanceof SourceRequestError && error.status === 409)) throw error;
  }
  const made = await findLabel(ctx, connectionId, name);
  if (made === undefined) throw new RunStepError("source_item_missing", "Gmail has no such item.");
  return made.id;
}

async function findLabel(ctx: Ctx, connectionId: string, name: string) {
  const listing = await proxyGet(ctx, connectionId, `${GMAIL}/labels`, labelsSchema);
  return listing?.labels.find((label) => label.name.toLowerCase() === name.toLowerCase());
}
