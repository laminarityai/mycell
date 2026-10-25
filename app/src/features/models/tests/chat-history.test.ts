import { describe, expect, it } from "vitest";
import { chatModelMessages, chatUIPart } from "../server";
import type { ChatMessage, ChatPart } from "../types";

// A second chat's own part kind beside the shared ones, as Ask Mycel's pending run will be.
type PendingRun = { type: "pending_run"; workflowId: string; runId: string | null };
type AskPart = ChatPart | PendingRun;

const pendingText = (part: PendingRun) =>
  part.runId === null ? `Offered to run ${part.workflowId}.` : undefined;

const tool = (toolCallId: string, output: unknown, isError = false): ChatPart => ({
  type: "tool",
  toolCallId,
  toolName: "look_up",
  input: { name: "Acme" },
  output,
  isError,
});

describe("chatModelMessages", () => {
  it("reads each model step's text and tool calls, the chat's own parts, and no notices", () => {
    const messages: ChatMessage<AskPart>[] = [
      { id: "m1", role: "user", parts: [{ type: "text", text: "Who handles Acme?" }] },
      {
        id: "m2",
        role: "assistant",
        parts: [
          { type: "text", text: "Looking." },
          tool("call-1", { objectId: "object-Acme" }),
          { type: "text", text: "Priya does." },
          { type: "pending_run", workflowId: "w-1", runId: null },
          { type: "pending_run", workflowId: "w-1", runId: "run-1" },
          { type: "notice", kind: "failed", text: "Stopped." },
        ],
      },
      {
        id: "m3",
        role: "user",
        parts: [
          { type: "text", text: "Run it." },
          { type: "pending_run", workflowId: "w-2", runId: null },
        ],
      },
      // A message of notices only reaches the model as nothing.
      { id: "m4", role: "user", parts: [{ type: "notice", kind: "failed", text: "Stopped." }] },
    ];

    expect(chatModelMessages(messages, pendingText)).toEqual([
      { role: "user", content: "Who handles Acme?" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Looking." },
          { type: "tool-call", toolCallId: "call-1", toolName: "look_up", input: { name: "Acme" } },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "look_up",
            output: { type: "json", value: { objectId: "object-Acme" } },
          },
        ],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Priya does." },
          { type: "text", text: "Offered to run w-1." },
        ],
      },
      { role: "user", content: "Run it.\nOffered to run w-2." },
    ]);
  });

  it("tells the model a failed tool call's stored error", () => {
    const messages: ChatMessage<AskPart>[] = [
      { id: "m1", role: "assistant", parts: [tool("call-1", "That tool call failed.", true)] },
    ];

    expect(chatModelMessages(messages, pendingText).at(-1)).toMatchObject({
      role: "tool",
      content: [{ output: { type: "error-text", value: "That tool call failed." } }],
    });
  });

  it("sends only the last turns' tool results, and says the older ones were dropped (#132)", () => {
    // Three turns, each the person's words and a reply with one tool call.
    const messages: ChatMessage<AskPart>[] = [1, 2, 3].flatMap((n) => [
      {
        id: `u${String(n)}`,
        role: "user" as const,
        parts: [{ type: "text", text: `Ask ${String(n)}` }],
      },
      {
        id: `a${String(n)}`,
        role: "assistant" as const,
        parts: [
          tool(`call-${String(n)}`, { objectId: `object-${String(n)}` }, n === 1),
          { type: "text", text: `Answer ${String(n)}` },
        ],
      },
    ]);

    const sent = chatModelMessages(messages, pendingText, { toolResultTurns: 2 });

    const outputs = sent.flatMap((message) =>
      message.role === "tool"
        ? message.content.flatMap((part) => (part.type === "tool-result" ? [part.output] : []))
        : [],
    );
    expect(outputs.slice(1)).toEqual([
      { type: "json", value: { objectId: "object-2" } },
      { type: "json", value: { objectId: "object-3" } },
    ]);
    expect(outputs[0]?.type).toBe("text");
    const dropped = JSON.stringify(outputs[0]);
    expect(dropped).toContain("dropped");
    expect(dropped).toContain("look_up again");
    expect(dropped).not.toContain("object-1");
    // Every call, and everything said, is still sent.
    const calls = sent.flatMap((message) =>
      message.role === "assistant" && typeof message.content !== "string" ? message.content : [],
    );
    expect(calls.filter((part) => part.type === "tool-call")).toHaveLength(3);
    expect(JSON.stringify(sent)).toContain("Answer 1");
    expect(JSON.stringify(sent)).toContain("Ask 1");
  });
});

describe("chatUIPart", () => {
  it("shows text, notices and tool calls as the chat page renders them", () => {
    expect(chatUIPart({ type: "text", text: "Hi" })).toEqual({ type: "text", text: "Hi" });
    expect(chatUIPart({ type: "notice", kind: "out_of_credits", text: "Out." })).toEqual({
      type: "data-notice",
      data: { kind: "out_of_credits", text: "Out." },
    });
    expect(chatUIPart(tool("call-1", { objectId: "object-Acme" }))).toEqual({
      type: "dynamic-tool",
      toolName: "look_up",
      toolCallId: "call-1",
      state: "output-available",
      input: { name: "Acme" },
      output: { objectId: "object-Acme" },
    });
    expect(chatUIPart(tool("call-2", "That tool call failed.", true))).toMatchObject({
      state: "output-error",
      errorText: "That tool call failed.",
    });
  });
});
