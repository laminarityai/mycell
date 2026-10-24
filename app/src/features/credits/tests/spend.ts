// Ledger rows the way production writes them: a real metered model call through the gateway
// client (the fake AI Gateway answers it), attributed as its caller would attribute it.
import { callModel } from "@/features/models/server";
import type { CallAttribution } from "@/features/models/types";
import type { Ctx } from "@/lib/ctx";
import { definePrompts } from "@/lib/prompts";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import spendFile from "./spend.prompt.yml";

const prompts = definePrompts(spendFile, { hi: [] });

/** Makes one model call that costs `credits` (at 1000 credits a dollar), for `attribution`. */
export async function spend(
  ctx: Ctx,
  credits: number,
  attribution: CallAttribution = {},
): Promise<void> {
  fakeAiGateway.text("ok", { costUsd: credits / 1000 });
  await callModel(ctx, "fast", { prompt: prompts.hi(), ...attribution });
}
