// read_examples: a live Gmail search on one connection the admin may build on, so the agent can
// ground a proposal in real messages. The messages reach the model in memory only; the
// conversation keeps their source refs, never a subject or body (invariant 8), and reopening it
// doesn't fetch them again unless the agent calls the tool again.
import { z } from "zod";
import { listConnections } from "@/features/connections/server";
import { SourceRequestError } from "@/features/connections/types";
import { readMessage, searchMessages } from "@/features/runtime/server";
import type { Ctx } from "@/lib/ctx";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { ToolDefinition } from "./tools";

/** How much of each body the model reads. */
const BODY_LENGTH = 2000;

const inputSchema = z.object({
  connectionId: z.string().min(1),
  query: z.string(),
  limit: z.number().int().min(1).max(5),
});

type Example = {
  sourceRef: string;
  threadId: string;
  from: string;
  date: string;
  subject: string;
  body: string;
};

type Examples = { connectionId: string; examples: Example[] };

export const readExamples: ToolDefinition<z.infer<typeof inputSchema>, Examples> = {
  description:
    "Search the mail of one connection listed under Connections, with Gmail's search syntax " +
    "(from:, subject:, newer_than:7d, free words), and read up to 5 of the newest matches: " +
    "sender, date, subject and the start of the body. Only for grounding a workflow in real " +
    "messages; you won't see them again later in the conversation unless you search again.",
  inputSchema,
  async execute(ctx, { connectionId, query, limit }) {
    await requireBuildable(ctx, connectionId);
    try {
      const refs = await searchMessages(ctx, connectionId, query, limit);
      const examples: Example[] = [];
      for (const ref of refs) {
        const message = await readMessage(ctx, connectionId, ref.id);
        if (message === null) continue;
        examples.push({
          sourceRef: ref.id,
          threadId: ref.threadId,
          ...message,
          body: message.body.slice(0, BODY_LENGTH),
        });
      }
      return { connectionId, examples };
    } catch (error) {
      // The source's answer may quote the mailbox, so the model gets only its status.
      if (error instanceof SourceRequestError) {
        throw new ValidationError(
          `Gmail refused the search (status ${String(error.status)}). Try a simpler query.`,
        );
      }
      throw error;
    }
  },
  stored: ({ connectionId, examples }) => ({
    connectionId,
    examples: examples.map(({ sourceRef, threadId }) => ({ sourceRef, threadId })),
  }),
};

/**
 * The admin's own connections and the org's, granted Gmail. Anyone else's member connection,
 * another admin's own included, is NotFoundError (ADR-0001), as is another org's.
 */
async function requireBuildable(ctx: Ctx, connectionId: string): Promise<void> {
  const listing = await listConnections(ctx);
  const connection = [...listing.connections, ...listing.orgConnections].find(
    (candidate) => candidate.id === connectionId,
  );
  if (connection === undefined) throw new NotFoundError("connection");
  if (!connection.apps.includes("gmail")) {
    throw new ValidationError(`${connection.accountEmail} wasn't granted Gmail.`);
  }
}
