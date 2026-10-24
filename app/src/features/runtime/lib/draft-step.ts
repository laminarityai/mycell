// The draft and approval steps. A draft step fetches its context, generates the reply on its
// role and hands it to its output action, all inside the one step, so the generated text never
// reaches the step state or the run's records (invariant 8). A run never sends the draft: the
// draft is itself what awaits the person (Gmail's pending form). The approval step records a
// review of it, which the person approves, edits or declines on the Reviews page (or finishes in
// Gmail), and the run goes on to its later steps.
import { z } from "zod";
import { callModel } from "@/features/models/server";
import { catalog } from "@/features/policy/catalog";
import { findStep, stepsAbove } from "@/features/spec/tree";
import type { Step } from "@/features/spec/types";
import { joinPrompts, type PromptText } from "@/lib/prompts";
import type { Json } from "@/lib/inngest";
import { calendarEventDetailsSchema } from "../types";
import { RunStepError } from "./failures";
import { messageRef, messageText, threadText } from "./gmail";
import { lookupText, MEMORY_LOOKUP } from "./memory-lookup";
import { draftPrompts } from "./prompts";
import { resolveInput } from "./references";
import { runAction } from "./run-action";
import { rangeText } from "./sheets";
import type { StepContext, StepExecution } from "./step-context";

type StepOf<T extends Step["type"]> = Extract<Step, { type: T }>;

export async function draftStep(
  step: StepOf<"draft">,
  context: StepContext,
): Promise<StepExecution> {
  const { ctx, run } = context;
  let model: StepExecution["model"];
  // Called by the action only when the step hasn't made its draft yet.
  const compose = async () => {
    const result = await callModel(ctx, step.role, {
      system: draftPrompts.system({ instructions: step.instructions }),
      prompt: await contextText(step, context),
      ...context.attribution,
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
async function contextText(step: StepOf<"draft">, context: StepContext): Promise<PromptText> {
  const { ctx, run } = context;
  const parts: PromptText[] = [];
  for (const name of step.context) {
    if (name === "trigger.message") {
      const message = await messageText(ctx, run.connectionId, run.sourceRef);
      parts.push(draftPrompts.triggerMessage({ message }));
    } else if (name === "trigger.thread") {
      const { threadId } = await messageRef(ctx, run.connectionId, run.sourceRef);
      const thread = await threadText(ctx, run.connectionId, threadId);
      parts.push(draftPrompts.triggerThread({ thread }));
    } else {
      const output = context.outputs[name] as Json | undefined;
      if (output === undefined) {
        throw new RunStepError("bad_reference", `The step ${name} has no output.`);
      }
      const sheet = await sheetText(name, context);
      const lookup = isLookup(name, context) ? lookupText(name, output) : undefined;
      parts.push(
        sheet ?? lookup ?? draftPrompts.stepOutput({ step: name, output: JSON.stringify(output) }),
      );
    }
  }
  return joinPrompts(parts, "\n\n");
}

/** Whether the step `name` is a memory lookup, whose facts read as a list. */
function isLookup(name: string, context: StepContext): boolean {
  const step = findStep(context.spec, name);
  return step?.type === "tool" && step.action === MEMORY_LOOKUP;
}

const RANGE_READ = catalog["google-sheet.read-range"];

/**
 * The values an earlier read-range step read, re-read here: that step handed on only the
 * range's counts, so the values never crossed a step boundary. Undefined for any other step.
 */
async function sheetText(name: string, context: StepContext): Promise<PromptText | undefined> {
  const step = findStep(context.spec, name);
  if (step?.type !== "tool" || step.action !== RANGE_READ.name) {
    return undefined;
  }
  const input = RANGE_READ.input.safeParse(await resolveInput(context, step.input));
  if (!input.success) {
    throw new RunStepError("invalid_input", `The input to ${step.action} is invalid.`);
  }
  const range = input.data as { spreadsheetId: string; range: string };
  const values = await rangeText(context.ctx, context.run.connectionId, range);
  return draftPrompts.sheetRange({ range: range.range, values });
}

// Whether the step is a tool step calling a custom write, whose output is its held send.
function isCustomWrite(step: Step, context: StepContext): boolean {
  if (step.type !== "tool") return false;
  const action = context.actionSet.find(step.action);
  return action?.kind === "custom" && action.risk !== "read";
}

// Whether the step is a tool step booking a meeting, whose output is its waiting event.
function booksEvent(step: Step, context: StepContext): boolean {
  if (step.type !== "tool") return false;
  const action = context.actionSet.find(step.action);
  return action?.kind === "catalog" && action.channel === "calendar_events";
}

const draftOutput = z.object({ draftId: z.string(), threadId: z.string() });
const heldSendOutput = z.object({ heldSendId: z.string(), connectionId: z.string() });
const suggestedOutput = z.object({ documentId: z.string(), suggestionIds: z.array(z.string()) });
const bookedOutput = z.object({
  eventId: z.string(),
  guests: calendarEventDetailsSchema.shape.guests,
  visibility: calendarEventDetailsSchema.shape.visibility,
  transparency: calendarEventDetailsSchema.shape.transparency,
});

// Whether the step is a tool step suggesting edits in a Doc, whose output is its suggestions.
function suggestsEdits(step: Step, context: StepContext): boolean {
  if (step.type !== "tool") return false;
  const action = context.actionSet.find(step.action);
  return action?.kind === "catalog" && action.channel === "suggested_edits";
}

/**
 * Records a review of each suggest-edits step above it that suggested anything, keeping the
 * suggestions' IDs. The run records only the documents' and suggestions' IDs.
 */
async function awaitSuggestions(steps: readonly Step[], context: StepContext) {
  const suggested = steps.flatMap((earlier) => {
    if (!suggestsEdits(earlier, context)) return [];
    const parsed = suggestedOutput.safeParse(context.outputs[earlier.id]);
    return parsed.success ? [parsed.data] : [];
  });
  const waiting = suggested.flatMap(({ documentId, suggestionIds }) => {
    const first = suggestionIds.at(0);
    return first === undefined ? [] : [{ documentId, first, suggestionIds }];
  });
  for (const { documentId, first, suggestionIds } of waiting) {
    await context.awaitReview({
      kind: "suggested_edits",
      itemRef: first,
      threadRef: documentId,
      details: { kind: "suggested_edits", suggestionIds },
    });
  }
  return waiting.map(({ documentId, suggestionIds }) => ({ documentId, suggestionIds }));
}

/**
 * Records a review of each meeting a tool step above it booked, keeping the guests approving it
 * invites. The run records only the events' IDs.
 */
async function awaitBookings(steps: readonly Step[], context: StepContext) {
  const booked = steps.flatMap((earlier) => {
    if (!booksEvent(earlier, context)) return [];
    const parsed = bookedOutput.safeParse(context.outputs[earlier.id]);
    return parsed.success ? [parsed.data] : [];
  });
  for (const { eventId, ...shown } of booked) {
    await context.awaitReview({
      kind: "calendar_event",
      itemRef: eventId,
      threadRef: eventId,
      details: { kind: "calendar_event", ...shown },
    });
  }
  return booked.map((event) => event.eventId);
}

/**
 * Records that what its channel reviews above it on its own path awaits a person: every Gmail
 * draft (`gmail_drafts`), every held send of a custom write (`held_send`), the edits each tool
 * step suggested in a Doc (`suggested_edits`) or every meeting a tool step booked
 * (`calendar_events`), those an approval above it recorded too, as a v1 approval recorded every
 * draft before it. Each gets a review on its owner's Reviews page (one per item, however often
 * the step or the run is retried). It holds nothing back: a run never sends either, so the steps
 * after it still run.
 */
export async function approvalStep(
  step: StepOf<"approval">,
  context: StepContext,
): Promise<StepExecution> {
  const stepsAboveIt = stepsAbove(context.spec, step.id);
  const above = stepsAboveIt.map((earlier) => context.outputs[earlier.id]);
  if (step.channel === "suggested_edits") {
    const suggested = await awaitSuggestions(stepsAboveIt, context);
    const record = { awaiting: "human", channel: step.channel, suggested };
    return { next: "continue", output: record, record };
  }
  if (step.channel === "calendar_events") {
    const eventIds = await awaitBookings(stepsAboveIt, context);
    const record = { awaiting: "human", channel: step.channel, eventIds };
    return { next: "continue", output: record, record };
  }
  if (step.channel === "held_send") {
    // Only a custom write's step holds a send: a read's result, filled from the app's answer,
    // may look like one.
    const sends = stepsAboveIt.flatMap((earlier) => {
      if (!isCustomWrite(earlier, context)) return [];
      const parsed = heldSendOutput.safeParse(context.outputs[earlier.id]);
      return parsed.success ? [parsed.data] : [];
    });
    for (const { heldSendId, connectionId } of sends) {
      await context.awaitReview({
        kind: "held_send",
        itemRef: heldSendId,
        threadRef: heldSendId,
        connectionId,
      });
    }
    const record = {
      awaiting: "human",
      channel: step.channel,
      heldSendIds: sends.map((send) => send.heldSendId),
    };
    return { next: "continue", output: record, record };
  }
  const drafts = above.flatMap((output) => {
    const parsed = draftOutput.safeParse(output);
    return parsed.success ? [parsed.data] : [];
  });
  for (const { draftId, threadId } of drafts) {
    await context.awaitReview({ kind: "approval", itemRef: draftId, threadRef: threadId });
  }
  const record = {
    awaiting: "human",
    channel: step.channel,
    draftIds: drafts.map((d) => d.draftId),
  };
  return { next: "continue", output: record, record };
}
