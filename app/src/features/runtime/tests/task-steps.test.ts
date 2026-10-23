// Google Tasks actions (M11, #68): adding and changing a task on the person's own default list
// runs with no review, a retried add leaves one task, the run records hold no title or notes, and
// a task assigned from Docs or Chat is left alone.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits } from "@/features/credits/server";
import { listReviews } from "@/features/reviews/server";
import { systemCtx } from "@/lib/ctx";
import { connectGoogle } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { executeRun, getRun, listRuns, startRun } from "../server";
import { pricingQuestion, publish, recordedBackoff, recordingStepRunner } from "./run-helpers";

beforeEach(resetDatabase);

const TITLE = "Call Ada about the oak chairs";
const NOTES = "She wants 30 delivered to Leeds.";
const BY = "Added by the Mycel workflow “follow-ups”";

const labelStep = {
  id: "label",
  type: "tool",
  action: "google-mail.add-label",
  input: { messageId: { from: "trigger.messageId" }, label: "Follow up" },
};

const detailsStep = {
  id: "details",
  type: "extract",
  role: "fast",
  fields: {
    title: { type: "string", description: "A one-line follow-up task" },
    notes: { type: "string", description: "What the follow-up needs to cover" },
    due: { type: "string", description: "When to follow up by, as YYYY-MM-DD" },
  },
};

const taskStep = {
  id: "task",
  type: "tool",
  action: "google-tasks.create-task",
  input: {
    title: { from: "details.title" },
    notes: { from: "details.notes" },
    due: { from: "details.due" },
  },
};

function spec(steps: Record<string, unknown>[]): Record<string, unknown> {
  return {
    specVersion: 2,
    id: "follow-ups",
    credentials: "member",
    trigger: { type: "gmail.message_received" },
    steps,
    autonomy: { rung: 3 },
  };
}

/** Org A's admin's Google account, with a pricing question and a workflow of `steps` on it. */
async function taskRun(steps: Record<string, unknown>[], scopes?: readonly string[]) {
  const { orgA } = await seedTwoOrgs();
  const admin = orgA.admin.ctx;
  const system = systemCtx(orgA.id);
  await grantCredits(system, 100);
  const google = await connectGoogle(admin, orgA.admin.email, scopes ? { scopes } : {});
  const message = google.mailbox.add(pricingQuestion());
  const workflowId = await publish(admin, spec(steps));
  const { runId } = await startRun(admin, workflowId, google.id, message.id);
  return { admin, system, google, message, tasks: google.tasks, workflowId, runId };
}

function scriptDetails() {
  fakeAiGateway.object({ title: TITLE, notes: NOTES, due: "2026-11-02" });
}

describe("a workflow that labels an email and adds a follow-up task", () => {
  it("labels it and adds one task to the default list, with no review", async () => {
    const { admin, system, google, message, tasks, runId } = await taskRun([
      labelStep,
      detailsStep,
      taskStep,
    ]);
    scriptDetails();

    expect(await executeRun(system, runId)).toEqual({ status: "succeeded" });

    expect(google.mailbox.labelNamesOf(message.id)).toContain("Follow up");
    const added = tasks.tasks();
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      title: TITLE,
      status: "needsAction",
      due: "2026-11-02T00:00:00.000Z",
    });
    expect(added[0]?.notes?.startsWith(`${NOTES}\n\n`)).toBe(true);
    expect(added[0]?.notes?.endsWith(`\n${BY}`)).toBe(true);
    expect(await listReviews(admin)).toEqual([]);
    expect((await getRun(admin, runId)).steps).toMatchObject([
      { stepId: "label", status: "succeeded" },
      { stepId: "details", status: "succeeded" },
      {
        stepId: "task",
        status: "succeeded",
        output: { fields: { taskId: { kind: "text", size: added[0]?.id.length } } },
      },
    ]);
  });

  it("adds exactly one task when its first answer was lost and it's tried again", async () => {
    const { admin, system, tasks, runId } = await taskRun([detailsStep, taskStep]);
    scriptDetails();
    tasks.loseNextAnswer();

    expect(await executeRun(system, runId, undefined, recordedBackoff())).toEqual({
      status: "succeeded",
    });

    expect(tasks.writes.filter((write) => write.method === "POST")).toHaveLength(1);
    expect(tasks.tasks()).toHaveLength(1);
    expect((await getRun(admin, runId)).steps).toMatchObject([
      { stepId: "details" },
      { stepId: "task", status: "succeeded", attempts: 2 },
    ]);
  });

  it("finds its earlier task even once the person has ticked it off in Tasks", async () => {
    const { system, tasks, runId } = await taskRun([detailsStep, taskStep]);
    scriptDetails();
    tasks.loseNextAnswer();
    const retry = recordedBackoff();
    // Before the retry, the person ticks the task off in Google's app, which hides it.
    const wait = retry.sleep;
    retry.sleep = async (ms) => {
      for (const task of tasks.tasks()) tasks.completeInApp(task.id);
      await wait(ms);
    };

    expect(await executeRun(system, runId, undefined, retry)).toEqual({ status: "succeeded" });

    expect(retry.waits).toHaveLength(1);
    expect(tasks.writes.filter((write) => write.method === "POST")).toHaveLength(1);
    expect(tasks.tasks()).toMatchObject([{ status: "completed", hidden: true }]);
  });

  it("keeps the task's title and notes out of every run record, handing on only its ID", async () => {
    const { admin, system, tasks, workflowId, runId } = await taskRun([
      labelStep,
      detailsStep,
      taskStep,
    ]);
    scriptDetails();
    const runner = recordingStepRunner();

    await executeRun(system, runId, runner.runStep);

    const runs = [await getRun(admin, runId), await listRuns(admin, workflowId)];
    const records = JSON.stringify(runs);
    for (const text of [TITLE, NOTES, "Leeds", "oak chairs", "Added by"]) {
      expect(records).not.toContain(text);
    }
    expect(runner.results()).toMatchObject({
      task: { output: { taskId: tasks.tasks()[0]?.id } },
    });
    expect(Object.keys((runner.results().task as { output: object }).output)).toEqual(["taskId"]);
  });
});

describe("the list-tasks action", () => {
  const listStep = { id: "open", type: "tool", action: "google-tasks.list-tasks", input: {} };

  it("lists the person's own open tasks, never one assigned from Docs or Chat", async () => {
    const { admin, system, tasks, runId } = await taskRun([listStep]);
    const own = tasks.add({ title: "Order oak", notes: "From the mill", due: "2026-11-05" });
    tasks.add({ title: "Done already", status: "completed" });
    tasks.add({ title: "Ticked off in the app", status: "completed", hidden: true });
    tasks.add({ title: "Review the contract", assignedFrom: "DOCUMENT" });
    tasks.add({ title: "Chase the invoice", assignedFrom: "SPACE" });
    const otherList = tasks.addList("Home");
    tasks.add({ title: "Buy milk", list: otherList });
    const runner = recordingStepRunner();

    expect(await executeRun(system, runId, runner.runStep)).toEqual({ status: "succeeded" });

    expect(runner.results()).toMatchObject({
      open: {
        output: {
          taskCount: 1,
          tasks: [{ id: own.id, title: "Order oak", notes: "From the mill", due: "2026-11-05" }],
        },
      },
    });
    expect(tasks.listRequests.every((params) => params.get("showAssigned") === "false")).toBe(true);
    const run = await getRun(admin, runId);
    expect(run.steps).toMatchObject([
      {
        stepId: "open",
        output: { fields: { taskCount: { kind: "number" }, tasks: { kind: "list", size: 1 } } },
      },
    ]);
    expect(JSON.stringify(run)).not.toContain("Order oak");
  });
});

describe("the update-task action", () => {
  const updateStep = (taskId: string) => ({
    id: "update",
    type: "tool",
    action: "google-tasks.update-task",
    input: { taskId, title: "Call Ada back", notes: "She called again.", done: true },
  });

  it("changes the person's own task, its notes ending with the workflow", async () => {
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    const google = await connectGoogle(admin, orgA.admin.email);
    const task = google.tasks.add({ title: "Call Ada", notes: "About chairs" });
    const message = google.mailbox.add(pricingQuestion());
    const workflowId = await publish(admin, spec([updateStep(task.id)]));
    const { runId } = await startRun(admin, workflowId, google.id, message.id);

    expect(await executeRun(systemCtx(orgA.id), runId)).toEqual({ status: "succeeded" });

    expect(google.tasks.tasks()).toMatchObject([
      {
        id: task.id,
        title: "Call Ada back",
        notes: "She called again.\n\nUpdated by the Mycel workflow “follow-ups”",
        status: "completed",
      },
    ]);
    expect(await listReviews(admin)).toEqual([]);
  });

  for (const assignedFrom of ["DOCUMENT", "SPACE"] as const) {
    it(`fails the step and changes nothing on a task assigned from ${assignedFrom}`, async () => {
      const { orgA } = await seedTwoOrgs();
      const admin = orgA.admin.ctx;
      const google = await connectGoogle(admin, orgA.admin.email);
      const task = google.tasks.add({ title: "Review the contract", assignedFrom });
      const message = google.mailbox.add(pricingQuestion());
      const workflowId = await publish(admin, spec([updateStep(task.id)]));
      const { runId } = await startRun(admin, workflowId, google.id, message.id);

      expect(await executeRun(systemCtx(orgA.id), runId, undefined, recordedBackoff())).toEqual({
        status: "failed",
      });

      expect(google.tasks.writes).toEqual([]);
      expect(google.tasks.tasks()).toEqual([task]);
      expect((await getRun(admin, runId)).steps).toMatchObject([
        { stepId: "update", status: "failed", attempts: 1, errorCode: "task_assigned" },
      ]);
    });
  }

  it("fails without retrying when the default list has no such task", async () => {
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    const google = await connectGoogle(admin, orgA.admin.email);
    const message = google.mailbox.add(pricingQuestion());
    const workflowId = await publish(admin, spec([updateStep("no-such-task")]));
    const { runId } = await startRun(admin, workflowId, google.id, message.id);

    await executeRun(systemCtx(orgA.id), runId, undefined, recordedBackoff());

    expect(google.tasks.writes).toEqual([]);
    expect((await getRun(admin, runId)).steps).toMatchObject([
      { stepId: "update", status: "failed", attempts: 1, errorCode: "source_item_missing" },
    ]);
  });
});
