// The draft and approval steps. A draft step fetches its context, generates the reply on its
// role and hands it to its output action, all inside the one step, so the generated text never
// reaches the step state or the run's records (invariant 8). In v1 the approval is the person
// sending the Gmail draft: we never send it, so the draft is itself what awaits them. The
// approval step records that, and the run goes on to its later steps.
import { z } from "zod";
import { findAction } from "@/features/policy/catalog";
import type { Step } from "@/features/spec/types";
import type { Json } from "../types";
import { callModel } from "./call-model";
import { RunStepError } from "./failures";
import { messageRef, messageText, threadText } from "./gmail";
import { resolveInput } from "./references";
import { runAction } from "./run-action";
import { rangeText } from "./sheets";
import type { StepContext, StepExecution } from "./step-context";

type StepOf<T extends Step["type"]> = Extract<Step, { type: T }>;

const SYSTEM = [
  "You write the body of an email reply on behalf of the mailbox's owner.",
  "Write only the reply's text: no subject line, no headers, no placeholders.",
  "Follow these instructions:",
].join(" ");

export async function draftStep(
  step: StepOf<"draft">,
  context: StepContext,
): Promise<StepExecution> {
  const { ctx, run } = context;
  let model: StepExecution["model"];
  // Called by the action only when the step hasn't made its draft yet.
  const compose = async () => {
    const result = await callModel(ctx, step.role, {
      system: `${SYSTEM}\n\n${step.instructions}`,
      prompt: await contextText(step, context),
      workflowId: run.workflowId,
      runId: run.id,
    });
    model = { role: step.role, modelId: result.modelId, costUsd: result.costUsd };
    return result.output;
  };
  // The draft replies to the triggering message.
  const input = { messageId: run.sourceRef };
  const value = await runAction(step.output, input, step.id, context, compose);
  return { next: "continue", output: value, record: value, ...(model ? { model } : {}) };
}

/** The step's context, as the model reads it, fetched inside the step and held in memory. */
async function contextText(step: StepOf<"draft">, context: StepContext): Promise<string> {
  const { ctx, run } = context;
  const parts: string[] = [];
  for (const name of step.context) {
    if (name === "trigger.message") {
      const text = await messageText(ctx, run.connectionId, run.sourceRef);
      parts.push(`The message you're replying to:\n\n${text}`);
    } else if (name === "trigger.thread") {
      const { threadId } = await messageRef(ctx, run.connectionId, run.sourceRef);
      parts.push(`The thread so far:\n\n${await threadText(ctx, run.connectionId, threadId)}`);
    } else {
      const output = context.outputs[name] as Json | undefined;
      if (output === undefined) {
        throw new RunStepError("bad_reference", `The step ${name} has no output.`);
      }
      const sheet = await sheetText(name, context);
      parts.push(sheet ?? `What the step "${name}" found: ${JSON.stringify(output)}`);
    }
  }
  return parts.join("\n\n");
}

const RANGE_READ = findAction("google-sheet.read-range");

/**
 * The values an earlier read-range step read, re-read here: that step handed on only the
 * range's counts, so the values never crossed a step boundary. Undefined for any other step.
 */
async function sheetText(name: string, context: StepContext): Promise<string | undefined> {
  const step = context.spec.steps.find((candidate) => candidate.id === name);
  if (step?.type !== "tool" || RANGE_READ === undefined || step.action !== RANGE_READ.name) {
    return undefined;
  }
  const input = RANGE_READ.input.safeParse(await resolveInput(context, step.input));
  if (!input.success) {
    throw new RunStepError("invalid_input", `The input to ${step.action} is invalid.`);
  }
  const range = input.data as { spreadsheetId: string; range: string };
  const values = await rangeText(context.ctx, context.run.connectionId, range);
  return `What the sheet range ${range.range} holds, one row per line, cells separated by tabs:\n\n${values}`;
}

const draftOutput = z.object({ draftId: z.string() });

/**
 * Records that the drafts before it await a person, who approves by sending one. It holds
 * nothing back: a Gmail draft is never sent by a run, so the steps after it still run.
 */
export function approvalStep(
  step: StepOf<"approval">,
  context: StepContext,
): Promise<StepExecution> {
  const draftIds = Object.values(context.outputs).flatMap((output) => {
    const parsed = draftOutput.safeParse(output);
    return parsed.success ? [parsed.data.draftId] : [];
  });
  const record = { awaiting: "human", channel: step.channel, draftIds };
  return Promise.resolve({ next: "continue", output: record, record });
}
