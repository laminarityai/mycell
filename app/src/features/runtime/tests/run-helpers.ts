// What the interpreter's tests share: an admin's inbox, a published workflow, and step runners
// that stand in for Inngest's.
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits } from "@/features/credits/server";
import { getWorkflow, publishWorkflow, saveWorkflow } from "@/features/workflows/server";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { connectMailbox } from "@/testing/connect-helpers";
import type { FakeMessageInput } from "@/testing/fake-gmail";
import { fakeNango } from "@/testing/fake-nango";
import { storedStepOutput } from "@/testing/inngest-step-state";
import { startRun } from "../server";
import type { RunRecord } from "../types";
import type { RunSleep, RunStep } from "@/lib/inngest";

/**
 * What a run's records hold, as JSON, for a scan for content: its record from `getRun` without
 * the spec it ran and the trace's words for its checks, which are the spec's literals, not the
 * message's.
 */
export function recordsOf(run: RunRecord): string {
  return JSON.stringify({ ...run, version: null, trace: null });
}

/** Connects the user's Gmail as a member connection and seeds its mailbox. */
export async function connectInbox(ctx: Ctx, emailAddress: string, messages: FakeMessageInput[]) {
  const { id, nangoConnectionId, mailbox } = await connectMailbox(ctx, emailAddress);
  const seeded = messages.map((message) => mailbox.add(message));
  return { connectionId: id, nangoConnectionId, mailbox, messages: seeded };
}

/** Saves and publishes `spec` as the admin, and returns the workflow's ID. */
export async function publish(admin: Ctx, spec: Record<string, unknown>): Promise<string> {
  const { id } = await saveWorkflow(admin, { name: String(spec.id), spec });
  await publishWorkflow(admin, id);
  const workflow = await getWorkflow(admin, id);
  if (workflow.versions.length === 0) throw new Error("not published");
  return id;
}

/**
 * Starts a run of `steps` on a pricing question in org A's admin's inbox, with `credits`
 * granted first. Returns the account's fake spreadsheets too, for seeding sheets.
 */
export async function runOn(steps: Record<string, unknown>[], credits = 100) {
  const { orgA } = await seedTwoOrgs();
  const admin = orgA.admin.ctx;
  const system = systemCtx(orgA.id);
  if (credits > 0) await grantCredits(system, credits);
  const inbox = await connectInbox(admin, orgA.admin.email, [pricingQuestion()]);
  const workflowId = await publish(admin, threadSpec({ steps }));
  const { runId } = await startRun(admin, workflowId, inbox.connectionId, inbox.messages[0].id);
  return { admin, system, runId, workflowId, sheets: fakeNango.sheets(inbox.nangoConnectionId) };
}

/**
 * A step runner that keeps what Inngest's step state would: each step's result as the client's
 * encryption middleware sends it (ciphertext, ADR-0021), or the error it threw with everything
 * Inngest serializes (name, message, stack, own fields, `cause`), which the middleware leaves
 * in the clear.
 */
export function stepStateRecorder() {
  const state: string[] = [];
  const runStep: RunStep = async (id, run) => {
    try {
      const result = await run();
      state.push(JSON.stringify({ id, result: await storedStepOutput(result) }));
      return result;
    } catch (error) {
      state.push(JSON.stringify({ id, thrown: serializedError(error) }));
      throw error;
    }
  };
  return { runStep, state };
}

function serializedError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  return {
    ...Object.fromEntries(Object.entries(error)),
    name: error.name,
    message: error.message,
    stack: error.stack,
    cause: serializedError(error.cause),
  };
}

/**
 * A RunSleep for `executeRun` that records each retry's wait instead of waiting: its length in
 * `waits`, its step ID in `ids`.
 */
export function recordedBackoff(): { sleep: RunSleep; waits: number[]; ids: string[] } {
  const waits: number[] = [];
  const ids: string[] = [];
  return {
    sleep: (id, ms) => {
      ids.push(id);
      waits.push(ms);
      return Promise.resolve();
    },
    waits,
    ids,
  };
}

const MINUTE = 60 * 1000;

/** An inbound pricing question, a minute old. */
export function pricingQuestion(overrides: Partial<FakeMessageInput> = {}): FakeMessageInput {
  return {
    from: "ada@customer.test",
    subject: "Quote for 30 oak chairs",
    text: "Hello, what would 30 oak chairs cost delivered to Leeds?",
    at: new Date(Date.now() - MINUTE),
    ...overrides,
  };
}

/** A classify step, asking whether the message is a pricing inquiry, with `checks`. */
export const classifyWith = (checks?: Record<string, unknown>) => ({
  id: "classify",
  type: "classify",
  role: "classify",
  question: "Is this a pricing inquiry?",
  labels: ["yes", "no"],
  checks,
});

/** An extract step `details` filling quantity, city and deadline on `fast`, with `checks`. */
export const extractWith = (checks?: Record<string, unknown>) => ({
  id: "details",
  type: "extract",
  role: "fast",
  fields: {
    quantity: { type: "number", description: "How many chairs" },
    city: { type: "string", description: "Where to deliver" },
    deadline: { type: "string", description: "When they're needed by" },
  },
  checks,
});

/** A model answer that quotes the message where the extract wants a number. */
export const OFF_SCHEMA = "30 oak chairs, delivered to Leeds";

/** classify → branch → read the thread. */
export function threadSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    specVersion: 1,
    id: "pricing-thread",
    credentials: "member",
    trigger: { type: "gmail.message_received" },
    steps: [
      {
        id: "classify",
        type: "classify",
        role: "classify",
        question: "Is this a pricing inquiry?",
        labels: ["yes", "no"],
      },
      {
        id: "gate",
        type: "branch",
        when: { step: "classify", label: "yes", minP: 0.8 },
        else: "stop",
      },
      {
        id: "thread",
        type: "tool",
        action: "google-mail.read-thread",
        input: { threadId: { from: "trigger.threadId" } },
      },
    ],
    autonomy: { rung: 3 },
    ...overrides,
  };
}
