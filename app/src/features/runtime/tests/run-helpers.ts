// What the interpreter's tests share: an admin's inbox, a published workflow, and step runners
// that stand in for Inngest's.
import { getWorkflow, publishWorkflow, saveWorkflow } from "@/features/workflows/server";
import type { Ctx } from "@/lib/ctx";
import { connectMailbox } from "@/testing/connect-helpers";
import type { FakeMessageInput } from "@/testing/fake-gmail";
import type { RetryPolicy, RunStep } from "../types";

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
 * A step runner like Inngest's: it records each step ID it's asked for and memoizes results by
 * ID, so running again replays finished steps instead of re-running them. `crashAt` makes it
 * throw before running that step, as an invocation that dies part-way would.
 */
export function recordingStepRunner() {
  const ids: string[] = [];
  const results = new Map<string, unknown>();
  let crashAt: string | undefined;
  const runStep: RunStep = async (id, run) => {
    ids.push(id);
    if (results.has(id)) return results.get(id) as Awaited<ReturnType<typeof run>>;
    if (id === crashAt) {
      crashAt = undefined;
      throw new Error(`crashed before ${id}`);
    }
    const result = await run();
    results.set(id, JSON.parse(JSON.stringify(result)) as unknown);
    return result;
  };
  return {
    runStep,
    ids,
    /** What the step state holds: each finished step's result, by step ID. */
    results: () => Object.fromEntries(results),
    crashAt: (id: string) => {
      crashAt = id;
    },
  };
}

/** The default attempts, with the waits recorded instead of slept. */
export function recordedBackoff(): RetryPolicy & { waits: number[] } {
  const waits: number[] = [];
  return {
    attempts: 3,
    delayMs: (attempt) => 1000 * 2 ** (attempt - 1),
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
    waits,
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
