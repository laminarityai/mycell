// Ask Mycel's turns, streamed to the chat page's AI SDK chat hook (one of the three allowed uses
// of a route handler: streaming). Any signed-in person, for their own conversations only.
import { z } from "zod";
import { streamTurn } from "@/features/agent/server";
import { findSessionCtx } from "@/features/orgs/server";
import { routeError } from "@/lib/errors";

// A turn may take several model steps (Vercel's limit; docs/research/stack-verification.md §2).
export const maxDuration = 300;

const bodySchema = z.object({ conversationId: z.string().min(1), message: z.string() });

export async function POST(request: Request): Promise<Response> {
  const ctx = await findSessionCtx();
  if (ctx === undefined) return new Response("Sign in first.", { status: 401 });
  const body = bodySchema.safeParse(await request.json().catch(() => undefined));
  if (!body.success) return new Response("Send a conversation ID and a message.", { status: 400 });
  try {
    return await streamTurn(ctx, body.data.conversationId, body.data.message);
  } catch (error) {
    return routeError(error);
  }
}
