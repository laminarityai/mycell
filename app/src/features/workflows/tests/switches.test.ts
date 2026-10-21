import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { disconnect } from "@/features/connections/server";
import { GOOGLE_APP_SCOPES } from "@/features/connections/types";
import { systemCtx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError, SpecInvalidError, ValidationError } from "@/lib/errors";
import { connectGoogle, connectMailbox, connectOldConnection } from "@/testing/connect-helpers";
import {
  getWorkflow,
  listSwitchedOn,
  listWorkflows,
  publishWorkflow,
  runnableConnections,
  saveWorkflow,
  switchWorkflowOff,
  switchWorkflowOn,
} from "../server";
import { labelSpec } from "./specs";

beforeEach(resetDatabase);

// Org A's admin with their own Google connection and a published member workflow.
async function memberWorkflow() {
  const orgs = await seedTwoOrgs();
  const admin = orgs.orgA.admin.ctx;
  const own = await connectMailbox(admin, orgs.orgA.admin.email);
  const { id } = await saveWorkflow(admin, { name: "Label", spec: labelSpec() });
  await publishWorkflow(admin, id);
  return { ...orgs, admin, own, workflowId: id };
}

// Org A's admin with an org connection and a published org workflow.
async function orgWorkflow() {
  const orgs = await seedTwoOrgs();
  const admin = orgs.orgA.admin.ctx;
  const support = await connectMailbox(admin, "support@org-a.test", [], "org");
  const { id } = await saveWorkflow(admin, {
    name: "Support",
    spec: labelSpec({ credentials: "org" }),
  });
  await publishWorkflow(admin, id);
  return { ...orgs, admin, support, workflowId: id };
}

describe("switching a member workflow on", () => {
  it("enables it on the admin's own connection, from now on", async () => {
    const { orgA, admin, own, workflowId } = await memberWorkflow();
    const before = new Date();

    await switchWorkflowOn(admin, workflowId, own.id);

    const workflow = await getWorkflow(admin, workflowId);
    expect(workflow.switch).toEqual({
      kind: "member",
      connectionId: own.id,
      since: expect.any(Date) as Date,
      status: "on",
      pausedReason: null,
      pausedChange: null,
      needsReconnect: false,
    });
    expect(workflow.switch?.since.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    const latest = workflow.versions[0];
    expect(await listSwitchedOn(systemCtx(orgA.id), own.id)).toEqual([
      {
        workflowId,
        switch: { kind: "member", enablementId: expect.any(String) as string },
        versionId: latest.id,
        since: workflow.switch?.since,
        labelIds: ["INBOX"],
      },
    ]);
  });

  it("switching on again moves nothing and starts no second enablement", async () => {
    const { orgA, admin, own, workflowId } = await memberWorkflow();

    await switchWorkflowOn(admin, workflowId, own.id);
    const first = (await getWorkflow(admin, workflowId)).switch;
    await switchWorkflowOn(admin, workflowId, own.id);

    expect((await getWorkflow(admin, workflowId)).switch).toEqual(first);
    expect(await listSwitchedOn(systemCtx(orgA.id), own.id)).toHaveLength(1);
  });

  it("refuses another member's connection and an org connection", async () => {
    const { orgA, admin, workflowId } = await memberWorkflow();
    const theirs = await connectMailbox(orgA.member.ctx, orgA.member.email);
    const support = await connectMailbox(admin, "support@org-a.test", [], "org");

    await expect(switchWorkflowOn(admin, workflowId, theirs.id)).rejects.toThrow(NotFoundError);
    await expect(switchWorkflowOn(admin, workflowId, support.id)).rejects.toThrow(ValidationError);
    expect((await getWorkflow(admin, workflowId)).switch).toBeNull();
  });

  it("refuses a workflow that was never published", async () => {
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    const own = await connectMailbox(admin, orgA.admin.email);
    const { id } = await saveWorkflow(admin, { name: "Label", spec: labelSpec() });

    await expect(switchWorkflowOn(admin, id, own.id)).rejects.toThrow(ValidationError);
    expect(await listSwitchedOn(systemCtx(orgA.id), own.id)).toEqual([]);
  });

  it("switching off deletes the enablement", async () => {
    const { orgA, admin, own, workflowId } = await memberWorkflow();
    await switchWorkflowOn(admin, workflowId, own.id);

    await switchWorkflowOff(admin, workflowId);

    expect((await getWorkflow(admin, workflowId)).switch).toBeNull();
    expect(await listSwitchedOn(systemCtx(orgA.id), own.id)).toEqual([]);
  });

  it("disconnecting the connection removes the enablement", async () => {
    const { admin, own, workflowId } = await memberWorkflow();
    await switchWorkflowOn(admin, workflowId, own.id);

    await disconnect(admin, own.id);

    expect((await getWorkflow(admin, workflowId)).switch).toBeNull();
  });
});

describe("switching an org workflow on", () => {
  it("records the org connection it runs on", async () => {
    const { orgA, admin, support, workflowId } = await orgWorkflow();

    await switchWorkflowOn(admin, workflowId, support.id);

    const workflow = await getWorkflow(admin, workflowId);
    expect(workflow.switch).toEqual({
      kind: "org",
      connectionId: support.id,
      since: expect.any(Date) as Date,
      status: "on",
      pausedReason: null,
      pausedChange: null,
      needsReconnect: false,
    });
    expect(await listSwitchedOn(systemCtx(orgA.id), support.id)).toEqual([
      {
        workflowId,
        switch: { kind: "org", workflowId },
        versionId: workflow.versions[0].id,
        since: workflow.switch?.since,
        labelIds: ["INBOX"],
      },
    ]);
  });

  it("checks the chosen connection alone: one not allowed Gmail is refused", async () => {
    const { admin, workflowId } = await orgWorkflow();
    const allButGmail = Object.values(GOOGLE_APP_SCOPES).filter(
      (scope) => scope !== GOOGLE_APP_SCOPES.gmail,
    );
    const sales = await connectGoogle(admin, "sales@org-a.test", {
      kind: "org",
      scopes: allButGmail,
    });

    await expect(switchWorkflowOn(admin, workflowId, sales.id)).rejects.toThrow(SpecInvalidError);
    expect((await getWorkflow(admin, workflowId)).switch).toBeNull();
  });

  it("refuses a member connection", async () => {
    const { orgA, admin, workflowId } = await orgWorkflow();
    const own = await connectMailbox(admin, orgA.admin.email);

    await expect(switchWorkflowOn(admin, workflowId, own.id)).rejects.toThrow(ValidationError);
  });

  it("switching off, or disconnecting, leaves it off", async () => {
    const { orgA, admin, support, workflowId } = await orgWorkflow();
    await switchWorkflowOn(admin, workflowId, support.id);
    await switchWorkflowOff(admin, workflowId);
    expect((await getWorkflow(admin, workflowId)).switch).toBeNull();

    await switchWorkflowOn(admin, workflowId, support.id);
    await disconnect(admin, support.id);

    expect((await getWorkflow(admin, workflowId)).switch).toBeNull();
    expect(await listSwitchedOn(systemCtx(orgA.id), support.id)).toEqual([]);
  });
});

describe("the connections a workflow can run on", () => {
  it("are the org connections allowed Gmail with the scopes it needs, its switch's first", async () => {
    const orgs = await seedTwoOrgs();
    const admin = orgs.orgA.admin.ctx;
    // Read-only Gmail, from before write access was asked for: it can't add a label.
    await connectOldConnection(admin, "gmail", "sales@org-a.test", { kind: "org" });
    const allButGmail = Object.values(GOOGLE_APP_SCOPES).filter(
      (scope) => scope !== GOOGLE_APP_SCOPES.gmail,
    );
    await connectGoogle(admin, "ops@org-a.test", { kind: "org", scopes: allButGmail });
    const support = await connectMailbox(admin, "support@org-a.test", [], "org");
    await connectMailbox(admin, "help@org-a.test", [], "org");
    await connectMailbox(admin, orgs.orgA.admin.email);
    const { id } = await saveWorkflow(admin, {
      name: "Support",
      spec: labelSpec({ credentials: "org" }),
    });
    await publishWorkflow(admin, id);

    const ids = async () => (await runnableConnections(admin, id)).map((c) => c.accountEmail);
    expect(await ids()).toEqual(["help@org-a.test", "support@org-a.test"]);

    await switchWorkflowOn(admin, id, support.id);
    expect(await ids()).toEqual(["support@org-a.test", "help@org-a.test"]);
  });

  it("are the admin's own connections for a member workflow, and admins' to ask for", async () => {
    const { orgA, admin, own, workflowId } = await memberWorkflow();
    await connectMailbox(admin, "support@org-a.test", [], "org");

    expect((await runnableConnections(admin, workflowId)).map((c) => c.id)).toEqual([own.id]);
    await expect(runnableConnections(orgA.member.ctx, workflowId)).rejects.toThrow(ForbiddenError);
  });
});

describe("the workflows list", () => {
  it("shows which workflows are on: the admin's own enablement, or the org switch", async () => {
    const { orgA, admin, support, workflowId: orgId } = await orgWorkflow();
    const own = await connectMailbox(admin, orgA.admin.email);
    const { id: memberId } = await saveWorkflow(admin, {
      name: "Label",
      spec: labelSpec({ id: "label-mine" }),
    });
    await publishWorkflow(admin, memberId);
    const { id: offId } = await saveWorkflow(admin, {
      name: "Off",
      spec: labelSpec({ id: "off" }),
    });
    await publishWorkflow(admin, offId);

    await switchWorkflowOn(admin, orgId, support.id);
    await switchWorkflowOn(admin, memberId, own.id);

    const since = expect.any(Date) as Date;
    expect(await listWorkflows(admin)).toMatchObject([
      { id: memberId, switch: { kind: "member", connectionId: own.id, since } },
      { id: offId, switch: null },
      { id: orgId, switch: { kind: "org", connectionId: support.id, since } },
    ]);
  });

  it("doesn't show another admin's enablement as on", async () => {
    const { orgA, admin, own, workflowId } = await memberWorkflow();
    await switchWorkflowOn(admin, workflowId, own.id);
    const promoted = { ...orgA.member.ctx, role: "admin" as const };

    expect(await listWorkflows(promoted)).toMatchObject([{ id: workflowId, switch: null }]);
  });
});

describe("in M3", () => {
  it("a member can't switch anything on or off, or list what's on", async () => {
    const { orgA, own, workflowId } = await memberWorkflow();
    const member = orgA.member.ctx;
    const theirs = await connectMailbox(member, orgA.member.email);

    await expect(switchWorkflowOn(member, workflowId, theirs.id)).rejects.toThrow(ForbiddenError);
    await expect(switchWorkflowOff(member, workflowId)).rejects.toThrow(ForbiddenError);
    await expect(listSwitchedOn(member, own.id)).rejects.toThrow(ForbiddenError);
    await expect(listSwitchedOn(orgA.admin.ctx, own.id)).rejects.toThrow(ForbiddenError);
  });
});
