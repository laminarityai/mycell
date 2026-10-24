// Scripting a turn in which the agent proposes specs: each spec is one `propose_spec` call
// (one model step), then the agent's closing text.
import type { Ctx } from "@/lib/ctx";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { readTurn, type StreamedTurn } from "@/testing/streamed-turn";
import { streamTurn } from "../server";

export const SUMMARY = "Draft replies to pricing questions.";

export async function proposeInTurn(
  ctx: Ctx,
  conversationId: string,
  specs: unknown[],
  options: { workflowId?: string; message?: string } = {},
): Promise<StreamedTurn> {
  for (const spec of specs) {
    const workflow = options.workflowId === undefined ? {} : { workflowId: options.workflowId };
    fakeAiGateway.reply({
      toolCalls: [{ name: "propose_spec", input: { ...workflow, spec, summary: SUMMARY } }],
    });
  }
  fakeAiGateway.reply({ text: "Have a look at the proposal." });
  return readTurn(
    await streamTurn(ctx, conversationId, options.message ?? "Draft replies to pricing questions"),
  );
}
