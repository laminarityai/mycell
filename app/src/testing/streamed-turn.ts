// Reading a chat's streamed turn (`models`' `streamChatTurn`, the builder's or any other chat's)
// the way the chat page does: the UI message stream's server-sent events, gathered into the
// reply's text, its tool calls, its notices and its errors. And funding an org for turns.
import { grantCredits } from "@/features/credits/server";
import { systemCtx } from "@/lib/ctx";

export type StreamedTurn = {
  /** The reply's text, joined from its deltas. */
  text: string;
  /** How many text deltas it arrived in: more than one means it streamed. */
  deltas: number;
  /** The tool calls the agent made, by name. */
  toolCalls: string[];
  notices: { kind: string; text: string }[];
  errors: string[];
  /** Each failed tool call's error, as the page shows it. */
  toolErrors: string[];
  /** Everything the page was sent. */
  raw: string;
};

export async function readTurn(response: Response): Promise<StreamedTurn> {
  const raw = await response.text();
  const turn: StreamedTurn = {
    text: "",
    deltas: 0,
    toolCalls: [],
    notices: [],
    errors: [],
    toolErrors: [],
    raw,
  };
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    const chunk = JSON.parse(line.slice("data: ".length)) as Record<string, unknown>;
    if (chunk.type === "text-delta") {
      turn.text += String(chunk.delta);
      turn.deltas += 1;
    }
    if (chunk.type === "tool-input-available") turn.toolCalls.push(String(chunk.toolName));
    if (chunk.type === "data-notice") {
      turn.notices.push(chunk.data as { kind: string; text: string });
    }
    if (chunk.type === "error") turn.errors.push(String(chunk.errorText));
    if (chunk.type === "tool-output-error") turn.toolErrors.push(String(chunk.errorText));
  }
  return turn;
}

/** Gives the org enough credits for a few turns. */
export async function fundOrg(orgId: string, credits = 1000): Promise<void> {
  await grantCredits(systemCtx(orgId), credits);
}
