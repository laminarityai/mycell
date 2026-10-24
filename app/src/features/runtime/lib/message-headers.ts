// Finding and reading messages by their headers only, for Ask Mycel (#181): a sender, a subject
// and when it arrived, never a body (format=metadata, asking only for From and Subject; Gmail's
// snippet of the body is never read). Only the caller's own member connection: a colleague's,
// or an org inbox an admin may read, is "not found". The Gmail query is built here, and what a
// person or a model wrote is searched as words, so it can't add Gmail operators. In memory
// only, like every message read: never stored (invariant 8).
import { z } from "zod";
import { GMAIL, headerValue, messageListSchema, messageSchema } from "@/features/connections/gmail";
import { sourceClient, sourceClients } from "@/features/connections/server";
import type { SourceClient } from "@/features/connections/types";
import { requireRole, type Ctx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import type { MessageHeaders, MessageRef, MessageSearch } from "../types";
import { isUnavailable } from "./recent-messages";

// What format=metadata gives: IDs, labels and the headers asked for. Picking leaves out the
// snippet Gmail adds, which is the body's opening words.
const headersSchema = messageSchema
  .pick({ id: true, labelIds: true, payload: true })
  .extend({ internalDate: z.string().default("0") });

const HEADERS = ["From", "Subject"];

/**
 * The newest messages in the caller's own member connection's mailbox matching `search`,
 * newest first, at most `search.limit`. NotFoundError for any other connection, an org inbox
 * the caller may read included. People only: the system ctx is no one's.
 */
export async function searchMessageHeaders(
  ctx: Ctx,
  connectionId: string,
  search: MessageSearch,
): Promise<MessageHeaders[]> {
  requireRole(ctx, "admin", "member");
  const source = await sourceClient(ctx, connectionId);
  if (!isOwn(ctx, source)) throw new NotFoundError("connection");
  const params = new URLSearchParams({ q: gmailQuery(search), maxResults: String(search.limit) });
  const found = await source.get(`${GMAIL}/messages?${params.toString()}`, messageListSchema);
  const read = await Promise.all((found?.messages ?? []).map((ref) => headersOf(source, ref.id)));
  return read.flatMap((message) => (message === null ? [] : [message]));
}

/**
 * The headers of each message in `refs` that's in the caller's own member connections' mail,
 * in their order, fetched again (for a page to show them). One Gmail no longer has, on a
 * connection that's gone or can't be read now, or on anyone else's connection, is left out.
 */
export async function readMessageHeaders(
  ctx: Ctx,
  refs: readonly MessageRef[],
): Promise<MessageHeaders[]> {
  requireRole(ctx, "admin", "member");
  if (refs.length === 0) return [];
  const clients = await sourceClients(
    ctx,
    refs.map((ref) => ref.connectionId),
  );
  const read = await Promise.all(
    refs.map(async (ref) => {
      const source = clients.get(ref.connectionId);
      if (source === undefined || !isOwn(ctx, source)) return null;
      try {
        return await headersOf(source, ref.sourceRef);
      } catch (error) {
        if (!isUnavailable(error)) throw error;
        return null;
      }
    }),
  );
  return read.flatMap((message) => (message === null ? [] : [message]));
}

function isOwn(ctx: Ctx, source: SourceClient): boolean {
  return source.connection.kind === "member" && source.connection.ownerUserId === ctx.userId;
}

async function headersOf(source: SourceClient, messageId: string): Promise<MessageHeaders | null> {
  const query = new URLSearchParams({ format: "metadata" });
  for (const name of HEADERS) query.append("metadataHeaders", name);
  const path = `${GMAIL}/messages/${encodeURIComponent(messageId)}?${query.toString()}`;
  const message = await source.get(path, headersSchema);
  // A draft is the person's own unsent mail, not a message in their mailbox yet.
  if (message === null || message.labelIds.includes("DRAFT")) return null;
  const header = (name: string) => headerValue(message.payload?.headers, name) ?? "";
  return {
    connectionId: source.connection.id,
    accountEmail: source.connection.accountEmail,
    sourceRef: message.id,
    from: header("From"),
    subject: header("Subject"),
    receivedAt: new Date(Number(message.internalDate)),
  };
}

/** The Gmail search for `search`: each part Gmail's own operator, the words quoted. */
function gmailQuery({ from, subject, after, before }: MessageSearch): string {
  return [
    ...phrase("from", from),
    ...phrase("subject", subject),
    ...(after === undefined ? [] : [`after:${seconds(after)}`]),
    ...(before === undefined ? [] : [`before:${seconds(before)}`]),
  ].join(" ");
}

// Gmail has no escape inside a quoted phrase, and reads OR, AND and `operator:` as search
// syntax. So the words go in quotes, in lower case (Gmail matches regardless of case, and only
// upper-case OR and AND are operators), without quotes, colons, brackets or backslashes (Gmail
// matches words regardless of punctuation). Nothing left, nothing searched for.
function phrase(operator: "from" | "subject", text: string | undefined): string[] {
  const words = (text ?? "")
    .toLowerCase()
    .replace(/["\\:()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return words === "" ? [] : [`${operator}:"${words}"`];
}

const seconds = (date: Date) => String(Math.floor(date.getTime() / 1000));
