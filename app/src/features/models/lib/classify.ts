// The classify role. Jev answers through experimental_decide (pinned exactly with `ai`, since
// it may change in patch releases), and this adapter normalizes its answer to `{ label, p }`.
// When Jev fails, or the org's classify model isn't a decision model, a structured-output call
// on `fast` answers instead, marked as a fallback; its `p` is the model's stated confidence.
import { experimental_decide } from "ai";
import { z } from "zod";
import type { Ctx } from "@/lib/ctx";
import { ModelCallError, type Classification, type ClassifyRequest } from "../types";
import { callModel, meteredCall } from "./call-model";
import { resolveModel } from "./model-roles";

// Gateway decision models: Jev, and Laya, which an org may try through its role table.
const DECISION_MODEL_PREFIXES = ["typesafe-ai/jev", "convaiinnovations/laya"];

const QUESTION_ID = "label";

export async function classify(ctx: Ctx, request: ClassifyRequest): Promise<Classification> {
  const modelId = await resolveModel(ctx, "classify");
  if (DECISION_MODEL_PREFIXES.some((prefix) => modelId.startsWith(prefix))) {
    try {
      return await decide(ctx, request);
    } catch (error) {
      if (!(error instanceof ModelCallError)) throw error;
    }
  }
  return fallback(ctx, request);
}

async function decide(ctx: Ctx, request: ClassifyRequest): Promise<Classification> {
  const { output, modelId, costUsd } = await meteredCall(
    ctx,
    "classify",
    request,
    async (gateway, modelId) => {
      const { answers } = await experimental_decide({
        model: gateway.provider.decisionModel(modelId),
        state: request.state,
        questions: {
          [QUESTION_ID]: {
            type: "choice",
            instructions: request.question,
            criteria: Object.fromEntries(request.labels.map((label) => [label, null])),
          },
        },
        maxRetries: 0,
      });
      const answer = answers[QUESTION_ID];
      if (!request.labels.includes(answer.choice)) {
        throw new ModelCallError("unknown_label", "classify", modelId);
      }
      const p = answer.probabilities?.[answer.choice];
      if (p === undefined) throw new ModelCallError("no_probabilities", "classify", modelId);
      return { label: answer.choice, p };
    },
  );
  return { ...output, modelId, costUsd, fallback: false };
}

async function fallback(ctx: Ctx, request: ClassifyRequest): Promise<Classification> {
  const schema = z.object({
    label: z.enum(request.labels as [string, ...string[]]),
    p: z.number().min(0).max(1).describe("Your confidence that the label is right, 0 to 1."),
  });
  const { output, modelId, costUsd } = await callModel(ctx, "fast", {
    system:
      "Classify the input. Answer with the one label that fits best, and your confidence in it.",
    prompt: `${request.question}\n\nLabels: ${request.labels.join(", ")}\n\nInput:\n${request.state}`,
    schema,
    workflowId: request.workflowId,
    runId: request.runId,
    dryRun: request.dryRun,
    purpose: request.purpose,
  });
  return { ...output, modelId, costUsd, fallback: true };
}
