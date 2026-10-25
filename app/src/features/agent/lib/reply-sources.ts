// What an Ask Mycel reply drew on, stored beside it so the reply goes when that does
// (invariant 3, #185): the facts its tools read, the connections those facts came from as the
// person saw them (memory's `citeFacts`), and the mailboxes its searches found messages in,
// whose senders and subjects it may repeat (#237). A fact can outlive one of its connections,
// through another copy of its email, so both are kept. The rows cascade with the connection or the fact,
// and a trigger then replaces the reply with a tombstone (`schema.ts`).
//
// A reply also inherits what the conversation's earlier replies drew on: the model read their
// words, and may repeat them. So when a fact or connection goes, every reply written after it
// was read goes too, not only the one that read it.
import { inArray } from "drizzle-orm";
import { isForeignKeyViolation } from "@/db/errors";
import { forOrg } from "@/db/for-org";
import { citeFacts } from "@/features/memory/server";
import type { Ctx } from "@/lib/ctx";
import type { AgentMessage, StoredPart } from "../types";
import { readFactIds } from "./citations";
import { appendMessage, type ConversationRow } from "./conversations";
import { foundConnectionIds } from "./mail-tools";
import { agentMessageConnections, agentMessageFacts } from "./schema";

/** A removed reply: its only part. The trigger writes the same. */
export const REMOVED_PARTS: StoredPart[] = [{ type: "removed" }];

// The foreign keys an insert breaks when what the reply drew on was deleted as it was written.
const GONE_FOREIGN_KEYS = [
  "agent_message_facts_fact_fk",
  "agent_message_connections_connection_fk",
];

type DrewOn = { factIds: string[]; connectionIds: string[] };

/**
 * Stores Mycel's reply with what it drew on. A reply that read a fact already gone, or one the
 * person no longer sees, is stored removed: it's what the trigger would have made of it.
 */
export async function storeReply(
  ctx: Ctx,
  conversation: ConversationRow,
  earlier: AgentMessage[],
  reply: { id: string; parts: StoredPart[] },
): Promise<void> {
  const message = { id: reply.id, role: "assistant" as const };
  const drew = await drewOn(ctx, earlier, reply.parts);
  if (drew !== null) {
    try {
      await forOrg(ctx).transaction(async (tx) => {
        await appendMessage(ctx, conversation, { ...message, parts: reply.parts }, tx);
        if (drew.factIds.length > 0) {
          await tx.insert(
            agentMessageFacts,
            drew.factIds.map((factId) => ({ messageId: reply.id, factId })),
          );
        }
        if (drew.connectionIds.length > 0) {
          await tx.insert(
            agentMessageConnections,
            drew.connectionIds.map((connectionId) => ({ messageId: reply.id, connectionId })),
          );
        }
      });
      return;
    } catch (error) {
      if (!GONE_FOREIGN_KEYS.some((name) => isForeignKeyViolation(error, name))) throw error;
    }
  }
  await appendMessage(ctx, conversation, { ...message, parts: REMOVED_PARTS });
}

/** What the reply drew on; null when something it read is gone already. */
async function drewOn(
  ctx: Ctx,
  earlier: AgentMessage[],
  parts: StoredPart[],
): Promise<DrewOn | null> {
  const read = readFactIds([{ parts }]);
  const cited = await citeFacts(ctx, read);
  if (cited.length < read.length) return null;
  const own: DrewOn = {
    factIds: read,
    connectionIds: [
      ...cited.flatMap((fact) => fact.sources.map((source) => source.connectionId)),
      ...foundConnectionIds(parts),
    ],
  };
  // A notice alone (out of credits) is ours, not the model's: it repeats nothing.
  if (parts.every((part) => part.type === "notice")) return distinct(own);
  const replies = earlier
    .filter((m) => m.role === "assistant" && !m.parts.some((part) => part.type === "removed"))
    .map((m) => m.id);
  if (replies.length === 0) return distinct(own);
  const db = forOrg(ctx);
  const [facts, connections] = await Promise.all([
    db.select(agentMessageFacts, {
      columns: ["factId"],
      where: inArray(agentMessageFacts.messageId, replies),
    }),
    db.select(agentMessageConnections, {
      columns: ["connectionId"],
      where: inArray(agentMessageConnections.messageId, replies),
    }),
  ]);
  return distinct({
    factIds: [...own.factIds, ...facts.map((row) => row.factId)],
    connectionIds: [...own.connectionIds, ...connections.map((row) => row.connectionId)],
  });
}

function distinct({ factIds, connectionIds }: DrewOn): DrewOn {
  return { factIds: [...new Set(factIds)], connectionIds: [...new Set(connectionIds)] };
}
