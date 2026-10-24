// A chat's tools, generic over the turn context `T` its chat hands each tool (the builder's
// `TurnInfo`). Each runs with the ctx of the person whose turn it is, so the model reaches only
// what they could, and says what the conversation keeps of its result: the whole result by
// default, or less (invariant 8). A chat's tools are a record by the name the model calls each.
import { tool, type Tool } from "ai";
import type { z } from "zod";
import type { Ctx } from "@/lib/ctx";
import type { PromptText } from "@/lib/prompts";

export type ChatToolDefinition<I, O, T> = {
  /** What the model is told the tool does, from the chat's own prompt file. */
  description: PromptText;
  inputSchema: z.ZodType<I>;
  execute(ctx: Ctx, input: I, turn: T): Promise<O>;
  /** What the conversation stores of the result; the result itself when left out. */
  stored?(output: O): unknown;
};

export type ChatTool<T> = {
  /** The AI SDK tool, bound to the person's ctx and the turn. */
  bind(ctx: Ctx, turn: T): Tool;
  stored(output: unknown): unknown;
};

/** Every tool a chat's model may call, by the name the model calls it. */
export type ChatTools<T> = Record<string, ChatTool<T>>;

export function chatTool<I, O, T>(definition: ChatToolDefinition<I, O, T>): ChatTool<T> {
  return {
    bind: (ctx, turn) =>
      tool({
        description: definition.description,
        inputSchema: definition.inputSchema as z.ZodType,
        // The SDK parses the model's input with `inputSchema` before it calls this.
        execute: (input: unknown): Promise<unknown> => definition.execute(ctx, input as I, turn),
      }),
    // The SDK hands back what `execute` returned, so the output is this tool's O.
    stored: (output) => (definition.stored ? definition.stored(output as O) : output),
  };
}

/** The chat's tools as the AI SDK takes them, each bound to the person's ctx and the turn. */
export function bindChatTools<T>(tools: ChatTools<T>, ctx: Ctx, turn: T): Record<string, Tool> {
  return Object.fromEntries(Object.entries(tools).map(([name, t]) => [name, t.bind(ctx, turn)]));
}

/** What the conversation keeps of a tool's result; a result of a tool it doesn't know, whole. */
export function storedOutput<T>(tools: ChatTools<T>, toolName: string, output: unknown): unknown {
  const chatTool = tools[toolName] as ChatTool<T> | undefined;
  return chatTool === undefined ? output : chatTool.stored(output);
}
