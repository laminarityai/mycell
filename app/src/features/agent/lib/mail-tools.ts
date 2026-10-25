// find_messages (#181): messages in the person's own mail, found by sender, subject and date
// through runtime's header-only search. It searches only the member connections the person owns,
// allowed Gmail, never a colleague's or an org inbox an admin may read. With none, it says
// message search needs one, and memory still answers. What's found is screened before the model
// reads it; the conversation keeps only where each message is (invariant 8), and the page
// fetches its sender and subject again to show it (`found.ts`).
import { z } from "zod";
import { listConnections } from "@/features/connections/server";
import { injectionScreenConfigured } from "@/features/models/server";
import { searchMessageHeaders } from "@/features/runtime/server";
import type { MessageHeaders, MessageRef, MessageSearch } from "@/features/runtime/types";
import type { Ctx } from "@/lib/ctx";
import { DAY_MS } from "@/lib/time";
import type { StoredPart } from "../types";
import { toolPrompts } from "./prompts";
import { noteFor, screenItems } from "./screen";
import type { AgentToolDefinition } from "./tools";

/** The most messages one search hands the model by default, and at most. */
const DEFAULT_MESSAGES = 10;
const MAX_MESSAGES = 20;

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(value)));

const findInput = z.object({
  from: z.string().trim().min(1).max(320).optional().describe(toolPrompts.findMessagesFrom()),
  subject: z.string().trim().min(1).max(200).optional().describe(toolPrompts.findMessagesSubject()),
  since: day.optional().describe(toolPrompts.findMessagesSince()),
  until: day.optional().describe(toolPrompts.findMessagesUntil()),
  limit: z.number().int().min(1).max(MAX_MESSAGES).optional(),
});

/** A message as the model reads it: its ID and connection to name it by, and its headers. */
type ModelMessage = {
  id: string;
  connectionId: string;
  from: string;
  subject: string;
  received: string;
};

type Found = { connected: true; messages: ModelMessage[]; screenedOut: number; note?: string };

/** No Google connection of the person's own to search, or nothing could be screened. */
type NotSearched = { connected: false; message: string } | { available: false; message: string };

/** What the conversation keeps of the result: where each message is, never its headers. */
export const storedFindSchema = z.union([
  z.object({ connected: z.literal(false) }),
  z.object({ available: z.literal(false) }),
  z.object({
    connected: z.literal(true),
    messages: z.array(z.object({ connectionId: z.string(), sourceRef: z.string() })),
    screenedOut: z.number(),
  }),
]);
type StoredFind = z.infer<typeof storedFindSchema>;

/**
 * The mailboxes a reply's searches found messages in. The model read those messages' senders
 * and subjects, and the reply may repeat them, so it goes with those connections (#237).
 */
export function foundConnectionIds(parts: StoredPart[]): string[] {
  return parts.flatMap((part) => {
    if (part.type !== "tool" || part.isError || part.toolName !== "find_messages") return [];
    const parsed = storedFindSchema.safeParse(part.output);
    if (!parsed.success || !("messages" in parsed.data)) return [];
    return parsed.data.messages.map((message) => message.connectionId);
  });
}

export const findMessagesTool: AgentToolDefinition<
  z.infer<typeof findInput>,
  Found | NotSearched
> = {
  description: toolPrompts.findMessages(),
  inputSchema: findInput,
  async execute(ctx, input) {
    // Nothing is read that couldn't be screened.
    if (!injectionScreenConfigured()) return unavailable();
    const own = await ownMailboxes(ctx);
    if (own.length === 0) return { connected: false, message: toolPrompts.noMailConnection() };
    const limit = input.limit ?? DEFAULT_MESSAGES;
    const search: MessageSearch = {
      ...(input.from === undefined ? {} : { from: input.from }),
      ...(input.subject === undefined ? {} : { subject: input.subject }),
      ...(input.since === undefined ? {} : { after: new Date(input.since) }),
      // Until the end of that day.
      ...(input.until === undefined ? {} : { before: new Date(Date.parse(input.until) + DAY_MS) }),
      limit,
    };
    const found = (
      await Promise.all(own.map((connectionId) => searchMessageHeaders(ctx, connectionId, search)))
    )
      .flat()
      .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
      .slice(0, limit);
    // A message's own framing as data, as the model reads it.
    const screened = await screenItems(ctx, found, (m) => `From: ${m.from}\nSubject: ${m.subject}`);
    if (!screened.ok) return unavailable();
    return {
      connected: true,
      messages: screened.kept.map(modelMessage),
      screenedOut: screened.dropped,
      ...noteFor(screened.dropped),
    };
  },
  stored: (output): StoredFind => {
    if ("available" in output) return { available: false };
    if (!output.connected) return { connected: false };
    return {
      connected: true,
      messages: output.messages.map((message): MessageRef => ({
        connectionId: message.connectionId,
        sourceRef: message.id,
      })),
      screenedOut: output.screenedOut,
    };
  },
};

// The person's own member connections allowed Gmail that Google still accepts. Admins' org
// connections are listed apart, and are never searched.
async function ownMailboxes(ctx: Ctx): Promise<string[]> {
  const { connections } = await listConnections(ctx);
  return connections
    .filter((connection) => connection.apps.includes("gmail"))
    .filter((connection) => connection.status !== "needs_reauth")
    .map((connection) => connection.id);
}

function modelMessage(message: MessageHeaders): ModelMessage {
  return {
    id: message.sourceRef,
    connectionId: message.connectionId,
    from: message.from,
    subject: message.subject,
    received: message.receivedAt.toISOString(),
  };
}

const unavailable = (): NotSearched => ({
  available: false,
  message: toolPrompts.mailUnavailable(),
});
