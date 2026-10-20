// Invariant 8 on every failure path: what a failed step hands Inngest's step state (its result
// or what it throws) and what the run records keep hold none of the message or the model's
// answer. Each case seeds content where the failure could pick it up.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { fakeNango } from "@/testing/fake-nango";
import { executeRun, getRun, listRuns } from "../server";
import {
  classifyWith,
  extractWith,
  OFF_SCHEMA,
  pricingQuestion,
  recordedBackoff,
  runOn,
  stepStateRecorder,
} from "./run-helpers";

beforeEach(resetDatabase);

const message = pricingQuestion();
const SEEDED = [
  message.subject,
  message.text,
  message.from,
  "oak chairs",
  "Leeds",
  // A model answer the checks refuse.
  "Hull",
];

const readThread = {
  id: "thread",
  type: "tool",
  action: "google-mail.read-thread",
  input: { threadId: { from: "trigger.threadId" } },
};

const thrice = (script: () => void) => () => {
  for (let attempt = 0; attempt < 3; attempt++) script();
};

type Case = {
  name: string;
  steps: Record<string, unknown>[];
  script?: () => void;
  credits?: number;
  code: string;
};

const cases: Case[] = [
  {
    name: "a classify below its minP",
    steps: [classifyWith({ minP: 0.95 })],
    script: () => {
      fakeAiGateway.decision({ choice: "yes", probabilities: { yes: 0.9, no: 0.1 } });
    },
    code: "check_min_p",
  },
  {
    name: "an extract off its schema check",
    steps: [extractWith({ schema: { properties: { city: { enum: ["York"] } } } })],
    script: () => {
      fakeAiGateway.object({ quantity: 30, city: "Hull", deadline: "oak chairs" });
    },
    code: "check_schema",
  },
  {
    name: "an extract missing a required field",
    steps: [extractWith({ requiredFields: ["deadline"] })],
    script: () => {
      fakeAiGateway.object({ quantity: 30, city: "Leeds", deadline: null });
    },
    code: "check_required_fields",
  },
  {
    name: "a model answer off the step's schema, with a schema check",
    steps: [extractWith({ schema: { type: "object" } })],
    script: () => {
      fakeAiGateway.object({ quantity: OFF_SCHEMA });
    },
    code: "check_schema",
  },
  {
    name: "a model answer off the step's schema, retried",
    steps: [extractWith()],
    script: thrice(() => {
      fakeAiGateway.object({ quantity: OFF_SCHEMA });
    }),
    code: "model_off_schema",
  },
  {
    name: "a Jev refusal whose fallback answers off the schema, retried",
    steps: [classifyWith()],
    script: thrice(() => {
      fakeAiGateway.decision("refusal");
      fakeAiGateway.object({ label: OFF_SCHEMA, p: 0.9 });
    }),
    code: "model_off_schema",
  },
  {
    name: "a gateway error, retried",
    steps: [extractWith()],
    script: thrice(() => {
      fakeAiGateway.fail("language", { status: 503 });
    }),
    code: "model_gateway_error",
  },
  {
    name: "a source that keeps rate limiting",
    steps: [readThread],
    script: () => {
      fakeNango.rateLimitSource(100);
    },
    code: "source_error",
  },
  { name: "no credits", steps: [extractWith()], credits: 0, code: "out_of_credits" },
  {
    name: "an action that isn't built yet",
    steps: [
      {
        id: "label",
        type: "tool",
        action: "google-mail.add-label",
        input: { messageId: { from: "trigger.messageId" }, label: "oak chairs" },
      },
    ],
    code: "not_available",
  },
];

describe("a failed step", () => {
  it.each(cases)("hands on and records no content: $name", async (failure) => {
    const { admin, system, runId, workflowId } = await runOn(failure.steps, failure.credits);
    failure.script?.();
    const recorder = stepStateRecorder();

    const outcome = await executeRun(system, runId, recorder.runStep, recordedBackoff());

    expect(outcome).toEqual({ status: "failed" });
    const run = await getRun(admin, runId);
    expect(run.steps.at(-1)?.errorCode).toBe(failure.code);
    const records = JSON.stringify([run, await listRuns(admin, workflowId)]);
    const state = recorder.state.join("\n");
    expect(state).not.toBe("");
    for (const content of SEEDED) {
      expect(state).not.toContain(content);
      expect(records).not.toContain(content);
    }
  });
});
