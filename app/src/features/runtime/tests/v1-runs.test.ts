import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedV1Workflow } from "@/db/testing/seed-workflow";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits } from "@/features/credits/server";
import { eachStep } from "@/features/spec/tree";
import { upgradeSpec } from "@/features/spec/upgrade";
import { specV1Schema } from "@/features/spec/v1";
import { validateSpec } from "@/features/spec/validate";
import { systemCtx } from "@/lib/ctx";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { executeRun, getRun, startRun } from "../server";
import {
  classifyWith,
  connectInbox,
  extractWith,
  pricingQuestion,
  threadSpec,
} from "./run-helpers";
import { recordingStepRunner } from "@/testing/recording-step-runner";

beforeEach(resetDatabase);

/** A run of a workflow published before branches had paths: classify, gate, read the thread. */
async function v1Run(otherwise: "stop" | "escalate" = "stop") {
  const { orgA } = await seedTwoOrgs();
  const admin = orgA.admin.ctx;
  const system = systemCtx(orgA.id);
  await grantCredits(system, 100);
  const inbox = await connectInbox(admin, orgA.admin.email, [pricingQuestion()]);
  const raw = threadSpec();
  const steps = raw.steps as Record<string, unknown>[];
  steps[1] = { ...steps[1], else: otherwise };
  const spec = specV1Schema.parse(raw);
  const { workflowId } = await seedV1Workflow({
    orgId: orgA.id,
    createdBy: orgA.admin.id,
    workingSpec: spec,
    published: { spec, maxRisk: "read", requiredActions: ["google-mail.read-thread"] },
  });
  const { runId } = await startRun(admin, workflowId, inbox.connectionId, inbox.messages[0].id);
  return { admin, system, runId };
}

const stepIds = async (admin: Parameters<typeof getRun>[0], runId: string) =>
  (await getRun(admin, runId)).steps.map((step) => step.stepId);

describe("this suite's v1 fixtures", () => {
  it("each upgrade to a valid v2 spec with the same step IDs, and once is enough", () => {
    const fixtures = [
      threadSpec(),
      threadSpec({
        steps: [classifyWith({ minP: 0.9 }), extractWith({ requiredFields: ["city"] })],
      }),
    ];
    for (const raw of fixtures) {
      const v1 = specV1Schema.parse(raw);
      const spec = upgradeSpec(v1);

      expect(validateSpec(spec)).toEqual({ ok: true, spec });
      expect(eachStep(spec).map(({ step }) => step.id)).toEqual(v1.steps.map((step) => step.id));
      expect(upgradeSpec(spec)).toEqual(spec);
    }
  });
});

describe("a run of a version published before branches had paths", () => {
  it("runs with the same step IDs as before", async () => {
    const { admin, system, runId } = await v1Run();
    fakeAiGateway.decision({ choice: "yes", probabilities: { yes: 0.9, no: 0.1 } }, { costUsd: 0 });
    const runner = recordingStepRunner();

    expect(await executeRun(system, runId, runner.runStep)).toEqual({ status: "succeeded" });

    expect(runner.ids).toEqual(["classify", "gate", "thread"]);
    expect(await stepIds(admin, runId)).toEqual(["classify", "gate", "thread"]);
  });

  it("stops where the gate stopped, and hands over where it escalated", async () => {
    const stopped = await v1Run("stop");
    fakeAiGateway.decision({ choice: "no", probabilities: { yes: 0.1, no: 0.9 } }, { costUsd: 0 });
    expect(await executeRun(stopped.system, stopped.runId)).toEqual({ status: "skipped" });
    expect(await stepIds(stopped.admin, stopped.runId)).toEqual(["classify", "gate"]);

    await resetDatabase();
    const escalated = await v1Run("escalate");
    fakeAiGateway.decision({ choice: "no", probabilities: { yes: 0.1, no: 0.9 } }, { costUsd: 0 });
    expect(await executeRun(escalated.system, escalated.runId)).toEqual({ status: "escalated" });
    expect(await stepIds(escalated.admin, escalated.runId)).toEqual([
      "classify",
      "gate",
      "gate-escalate",
    ]);
  });

  it("resumes on the gate's path when the gate's v1 result was memoized before the deploy", async () => {
    const { admin, system, runId } = await v1Run();
    const runner = recordingStepRunner();
    // What Inngest's step state held for the run: v1's step results, by step ID.
    runner.memoize("classify", { ended: null, output: { label: "yes", p: 0.9 } });
    runner.memoize("gate", { ended: null, output: { passed: true } });

    expect(await executeRun(system, runId, runner.runStep)).toEqual({ status: "succeeded" });

    expect(runner.ids).toEqual(["classify", "gate", "thread"]);
    expect(fakeAiGateway.requests()).toEqual([]);
    expect(await stepIds(admin, runId)).toEqual(["thread"]);
  });

  it("ends as the gate did when the gate's v1 result ended the run", async () => {
    const { system, runId } = await v1Run("escalate");
    const runner = recordingStepRunner();
    runner.memoize("classify", { ended: null, output: { label: "no", p: 0.9 } });
    runner.memoize("gate", { ended: "escalated", output: { passed: false } });

    expect(await executeRun(system, runId, runner.runStep)).toEqual({ status: "escalated" });

    expect(runner.ids).toEqual(["classify", "gate"]);
  });
});
