import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { listConnections } from "@/features/connections/server";
import { saveWorkflow } from "@/features/workflows/server";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { connectOrgInbox } from "@/testing/connect-helpers";
import { fakeInngest } from "@/testing/fake-inngest";
import { executeRun, getRun, listRuns, startRun } from "../server";
import { connectInbox, pricingQuestion, publish, threadSpec } from "./run-helpers";

beforeEach(resetDatabase);

async function adminWithInbox() {
  const { orgA } = await seedTwoOrgs();
  const inbox = await connectInbox(orgA.admin.ctx, orgA.admin.email, [pricingQuestion()]);
  return { orgA, admin: orgA.admin.ctx, inbox };
}

describe("startRun", () => {
  it("records a running run on the latest version and asks for it to execute", async () => {
    const { admin, inbox } = await adminWithInbox();
    const workflowId = await publish(admin, threadSpec());

    const { runId } = await startRun(admin, workflowId, inbox.connectionId, " msg-1 ");

    expect(await getRun(admin, runId)).toMatchObject({
      status: "running",
      sourceRef: "msg-1",
      enablementId: null,
      finishedAt: null,
      steps: [],
    });
    expect(fakeInngest.sent("runtime/run.requested")).toMatchObject([
      { data: { runId, connectionId: inbox.connectionId } },
    ]);
  });

  it("refuses a workflow that isn't published", async () => {
    const { admin, inbox } = await adminWithInbox();
    const { id } = await saveWorkflow(admin, { name: "Draft", spec: threadSpec() });

    await expect(startRun(admin, id, inbox.connectionId, "msg-1")).rejects.toThrow(ValidationError);
  });

  it("refuses an org connection for a member-credential workflow", async () => {
    const { orgA, admin } = await adminWithInbox();
    const workflowId = await publish(admin, threadSpec());
    await connectOrgInbox(admin, `sales@${orgA.workspaceDomain}`);
    const orgConnection = (await listConnections(admin)).orgConnections.at(0);
    if (orgConnection === undefined) throw new Error("no org connection");

    await expect(startRun(admin, workflowId, orgConnection.id, "msg-1")).rejects.toThrow(
      ValidationError,
    );
  });

  it("refuses another member's connection, and members altogether", async () => {
    const { orgA, admin } = await adminWithInbox();
    const workflowId = await publish(admin, threadSpec());
    const memberInbox = await connectInbox(orgA.member.ctx, orgA.member.email, []);

    await expect(startRun(admin, workflowId, memberInbox.connectionId, "m")).rejects.toThrow(
      ForbiddenError,
    );
    await expect(
      startRun(orgA.member.ctx, workflowId, memberInbox.connectionId, "m"),
    ).rejects.toThrow(ForbiddenError);
  });

  it("leaves executing to the system ctx", async () => {
    const { admin, inbox } = await adminWithInbox();
    const workflowId = await publish(admin, threadSpec());
    const { runId } = await startRun(admin, workflowId, inbox.connectionId, "msg-1");

    await expect(executeRun(admin, runId)).rejects.toThrow(ForbiddenError);
  });
});

describe("listRuns", () => {
  it("lists the workflow's runs, newest first", async () => {
    const { admin, inbox } = await adminWithInbox();
    const workflowId = await publish(admin, threadSpec());
    const first = await startRun(admin, workflowId, inbox.connectionId, "msg-1");
    const second = await startRun(admin, workflowId, inbox.connectionId, "msg-2");

    const listed = await listRuns(admin, { workflowId });

    expect(listed.runs.map((run) => run.id)).toEqual([second.runId, first.runId]);
  });
});

describe("reading runs", () => {
  // Org A's admin has a run on their own inbox and one on an org inbox; the member, promoted to
  // admin, has one on their own inbox.
  async function threeRuns() {
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    const promoted = { ...orgA.member.ctx, role: "admin" as const };
    const own = await connectInbox(admin, orgA.admin.email, []);
    const others = await connectInbox(promoted, orgA.member.email, []);
    await connectOrgInbox(admin, `sales@${orgA.workspaceDomain}`);
    const org = (await listConnections(admin)).orgConnections.at(0);
    if (org === undefined) throw new Error("no org connection");
    const memberWorkflow = await publish(admin, threadSpec());
    const orgWorkflow = await publish(admin, threadSpec({ id: "org", credentials: "org" }));
    const ownRun = await startRun(admin, memberWorkflow, own.connectionId, "m-1");
    const otherRun = await startRun(promoted, memberWorkflow, others.connectionId, "m-2");
    const orgRun = await startRun(admin, orgWorkflow, org.id, "m-3");
    return { orgA, admin, promoted, memberWorkflow, orgWorkflow, ownRun, otherRun, orgRun };
  }

  it("gives an admin their own member runs and the org's in full, another user's redacted", async () => {
    const { admin, ownRun, otherRun, orgRun } = await threeRuns();

    expect(await getRun(admin, ownRun.runId)).toMatchObject({ id: ownRun.runId, full: true });
    expect(await getRun(admin, orgRun.runId)).toMatchObject({ id: orgRun.runId, full: true });
    expect(await getRun(admin, otherRun.runId)).toMatchObject({
      id: otherRun.runId,
      full: false,
      sourceRef: null,
    });
  });

  it("gives another admin their own member runs and the org's in full, the first's redacted", async () => {
    const { promoted, ownRun, otherRun, orgRun } = await threeRuns();

    expect(await getRun(promoted, otherRun.runId)).toMatchObject({ full: true, sourceRef: "m-2" });
    expect(await getRun(promoted, orgRun.runId)).toMatchObject({ full: true, sourceRef: "m-3" });
    expect(await getRun(promoted, ownRun.runId)).toMatchObject({ full: false, sourceRef: null });
  });

  it("gives a member their own runs, and no one else's", async () => {
    const { orgA, ownRun, otherRun, orgRun } = await threeRuns();
    const member = orgA.member.ctx;

    expect(await getRun(member, otherRun.runId)).toMatchObject({ full: true, sourceRef: "m-2" });
    await expect(getRun(member, ownRun.runId)).rejects.toThrow(ForbiddenError);
    await expect(getRun(member, orgRun.runId)).rejects.toThrow(ForbiddenError);
  });
});
