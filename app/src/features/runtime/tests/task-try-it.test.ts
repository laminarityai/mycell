// Tasks actions in Try it (M11, #68): listing runs for real, and adding or changing a task only
// reports what it would do, writing nothing. An assigned task is refused here too.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { saveWorkflow } from "@/features/workflows/server";
import { connectGoogle } from "@/testing/connect-helpers";
import { dryRun } from "../server";
import { pricingQuestion } from "./run-helpers";

beforeEach(resetDatabase);

function specOf(steps: Record<string, unknown>[]) {
  return {
    specVersion: 2,
    id: "follow-ups",
    credentials: "member",
    trigger: { type: "gmail.message_received" },
    steps,
    autonomy: { rung: 3 },
  };
}

async function tryItSetup() {
  const { orgA } = await seedTwoOrgs();
  const admin = orgA.admin.ctx;
  const google = await connectGoogle(admin, orgA.admin.email);
  const message = google.mailbox.add(pricingQuestion());
  return { admin, google, message };
}

describe("Tasks actions in Try it", () => {
  it("lists the open tasks, and reports the task it would add, adding none", async () => {
    const { admin, google, message } = await tryItSetup();
    const own = google.tasks.add({ title: "Order oak" });
    const spec = specOf([
      { id: "open", type: "tool", action: "google-tasks.list-tasks", input: {} },
      {
        id: "task",
        type: "tool",
        action: "google-tasks.create-task",
        input: { title: "Call Ada back", notes: "About the chairs", due: "2026-11-02" },
      },
    ]);
    const { id: workflowId } = await saveWorkflow(admin, { name: "Follow-ups", spec });

    const result = await dryRun(admin, spec, {
      connectionId: google.id,
      sourceRef: message.id,
      workflowId,
    });

    expect(result).toMatchObject({
      ended: "succeeded",
      steps: [
        { stepId: "open", output: { taskCount: 1, tasks: [{ id: own.id, title: "Order oak" }] } },
        {
          stepId: "task",
          effect: {
            kind: "task",
            title: "Call Ada back",
            notes: "About the chairs\n\nAdded by the Mycel workflow “Follow-ups”",
            due: "2026-11-02",
          },
        },
      ],
    });
    expect(google.tasks.writes).toEqual([]);
    expect(google.tasks.tasks()).toHaveLength(1);
  });

  it("reports a change to the person's own task, and refuses one assigned from Docs", async () => {
    const { admin, google, message } = await tryItSetup();
    const own = google.tasks.add({ title: "Call Ada" });
    const assigned = google.tasks.add({ title: "Review the contract", assignedFrom: "DOCUMENT" });
    const update = (id: string, taskId: string) => ({
      id,
      type: "tool",
      action: "google-tasks.update-task",
      input: { taskId, due: "2026-11-09", done: false },
    });

    const result = await dryRun(
      admin,
      specOf([update("own", own.id), update("assigned", assigned.id)]),
      { connectionId: google.id, sourceRef: message.id },
    );

    expect(result).toMatchObject({
      ended: "failed",
      steps: [
        {
          stepId: "own",
          status: "succeeded",
          effect: { kind: "task_update", title: null, notes: null, due: "2026-11-09", done: false },
        },
        { stepId: "assigned", status: "failed", error: { code: "task_assigned" } },
      ],
    });
    expect(google.tasks.writes).toEqual([]);
  });
});
