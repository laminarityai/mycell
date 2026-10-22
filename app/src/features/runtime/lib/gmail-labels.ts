// The add-label action: find the label by name or create it, then put it on the message. Each
// write checks first for what an earlier try already did, so a retry whose first answer was
// lost labels the message once and makes one label.
import { z } from "zod";
import { sourceClient } from "@/features/connections/server";
import { SourceRequestError, type SourceClient } from "@/features/connections/types";
import type { Ctx } from "@/lib/ctx";
import { RunStepError } from "./failures";
import { GMAIL, messageRefSchema } from "./gmail";

const labelSchema = z.object({ id: z.string(), name: z.string() });
const labelsSchema = z.object({ labels: z.array(labelSchema).default([]) });

/** Puts the label named `label` on the message, making the label if the mailbox lacks it. */
export async function addLabel(
  ctx: Ctx,
  connectionId: string,
  input: { messageId: string; label: string },
): Promise<{ messageId: string; labelId: string }> {
  // Several calls, one connection read.
  const source = await sourceClient(ctx, connectionId);
  const labelId = await labelIdFor(source, input.label);
  const message = found(
    await source.get(
      `${GMAIL}/messages/${encodeURIComponent(input.messageId)}?format=minimal`,
      messageRefSchema,
    ),
  );
  if (!message.labelIds.includes(labelId)) {
    const path = `${GMAIL}/messages/${encodeURIComponent(message.id)}/modify`;
    found(await source.post(path, { addLabelIds: [labelId] }, z.unknown()));
  }
  return { messageId: message.id, labelId };
}

function found<T>(answer: T | null): T {
  if (answer === null) throw new RunStepError("source_item_missing", "Gmail has no such item.");
  return answer;
}

// Gmail's label names are unique regardless of case.
async function labelIdFor(source: SourceClient, name: string): Promise<string> {
  const existing = await findLabel(source, name);
  if (existing !== undefined) return existing.id;
  try {
    const created = await source.post(`${GMAIL}/labels`, { name }, labelSchema);
    if (created !== null) return created.id;
  } catch (error) {
    // 409: another writer made it since the listing, so it's there now.
    if (!(error instanceof SourceRequestError && error.status === 409)) throw error;
  }
  return found((await findLabel(source, name)) ?? null).id;
}

async function findLabel(source: SourceClient, name: string) {
  const listing = await source.get(`${GMAIL}/labels`, labelsSchema);
  return listing?.labels.find((label) => label.name.toLowerCase() === name.toLowerCase());
}
