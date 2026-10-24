// The AI Gateway's streamed answer to one model step, as server-sent events: shared by the
// fake Vitest installs (fake-ai-gateway.ts) and the one the e2e server talks to
// (e2e/fake-ai-gateway-server.ts). Pure: no msw, no env.

/** One streamed model step: text, tool calls, or both. */
export type FakeStreamedReply = {
  text?: string;
  toolCalls?: { name: string; input: unknown }[];
};

let toolCallCount = 0;

/**
 * The gateway streams LanguageModelV4 stream parts, one JSON object per event: the text in a
 * few deltas, then each tool call, then the finish with the cost in US dollars.
 */
export function streamedReplyEvents(
  reply: FakeStreamedReply,
  costUsd?: number,
  generationId?: string,
): string {
  const toolCalls = reply.toolCalls ?? [];
  const parts: unknown[] = [{ type: "stream-start", warnings: [] }];
  if (reply.text !== undefined) {
    parts.push({ type: "text-start", id: "text-1" });
    for (const delta of reply.text.match(/\S+\s*|\s+/g) ?? []) {
      parts.push({ type: "text-delta", id: "text-1", delta });
    }
    parts.push({ type: "text-end", id: "text-1" });
  }
  toolCalls.forEach((call, index) => {
    parts.push({
      type: "tool-call",
      toolCallId: `call-${String(++toolCallCount)}-${String(index)}`,
      toolName: call.name,
      input: JSON.stringify(call.input),
    });
  });
  const finish = toolCalls.length > 0 ? "tool-calls" : "stop";
  parts.push({
    type: "finish",
    finishReason: { unified: finish, raw: finish },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 5, text: 5, reasoning: 0 },
    },
    providerMetadata: costMetadata(costUsd, generationId),
  });
  return parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join("");
}

/** The gateway reports cost as a string of US dollars, beside the answer's generation ID. */
export function costMetadata(costUsd: number | undefined, generationId?: string) {
  if (costUsd === undefined && generationId === undefined) return undefined;
  return {
    gateway: {
      ...(costUsd === undefined ? {} : { cost: String(costUsd) }),
      ...(generationId === undefined ? {} : { generationId }),
    },
  };
}
