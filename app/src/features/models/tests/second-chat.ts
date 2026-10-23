// A second chat beside the builder's, as Ask Mycel will be: a turn context, a tool and storage
// of its own, run through the shared metered turn. Its messages are kept in memory.
import { z } from "zod";
import type { Ctx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { chatTool, streamChatTurn } from "../server";
import type { CallAttribution, ChatPart } from "../types";
import { testPrompts } from "./requests";

/** What the second chat's tool knows about the turn, and the state it keeps on it. */
export type AskTurn = { asker: string; lookedUp: string[] };

export const askTools = {
  look_up: chatTool({
    description: testPrompts.lookUp(),
    inputSchema: z.object({ name: z.string().min(1) }),
    execute(_ctx: Ctx, { name }: { name: string }, turn: AskTurn) {
      turn.lookedUp.push(name);
      if (name === "Nobody") return Promise.reject(new NotFoundError("Nobody goes by that name."));
      return Promise.resolve({ objectId: `object-${name}`, said: `${name} fetched-words` });
    },
    // The conversation keeps only the ID, never what was fetched.
    stored: ({ objectId }) => ({ objectId }),
  }),
};

export type StoredAskMessage = { id: string; parts: ChatPart[] };

export type AskOptions = { maxSteps?: number; attribution?: CallAttribution };

/** One turn of the second chat; what it stores lands in `stored`. */
export function askTurn(
  ctx: Ctx,
  message: string,
  stored: StoredAskMessage[],
  turn: AskTurn = { asker: ctx.userId, lookedUp: [] },
  options: AskOptions = {},
): Promise<Response> {
  return streamChatTurn(ctx, {
    role: "smart",
    attribution: options.attribution,
    tools: askTools,
    turn,
    maxSteps: options.maxSteps ?? 4,
    failedText: "Ask Mycel stopped before it finished.",
    prepare: () =>
      Promise.resolve({
        instructions: testPrompts.answerFromTools(),
        messages: [{ role: "user", content: message }],
      }),
    store: (assistantMessage) => {
      stored.push(assistantMessage);
      return Promise.resolve();
    },
  });
}
