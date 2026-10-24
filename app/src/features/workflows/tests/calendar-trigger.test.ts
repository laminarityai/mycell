// Workflows that start on a new invite (M11, #70): they need Calendar where Gmail workflows need
// Gmail, at save, at switch-on, at enabling, and when a new version changes the trigger.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { GOOGLE_APP_SCOPES } from "@/features/connections/types";
import { SpecInvalidError } from "@/lib/errors";
import { systemCtx } from "@/lib/ctx";
import { connectGoogle } from "@/testing/connect-helpers";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import {
  enable,
  getVisibleWorkflow,
  listSwitchedOn,
  previewPublish,
  publishWorkflow,
  saveWorkflow,
  switchWorkflowOn,
} from "../server";
import { labelSpec } from "./specs";

beforeEach(resetDatabase);

const allBut = (app: keyof typeof GOOGLE_APP_SCOPES) =>
  Object.entries(GOOGLE_APP_SCOPES).flatMap(([name, scope]) => (name === app ? [] : [scope]));

function inviteSpec(credentials: "member" | "org" = "member"): Record<string, unknown> {
  return {
    specVersion: 2,
    id: "sales-invites",
    credentials,
    trigger: { type: "calendar.invite_received" },
    steps: [
      {
        id: "kind",
        type: "classify",
        role: "classify",
        question: "Is this a sales call?",
        labels: ["yes", "no"],
      },
    ],
    autonomy: { rung: 3 },
  };
}

async function issuesOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof SpecInvalidError)) throw new Error("expected SpecInvalidError");
  return error.issues;
}

describe("saving a Calendar-triggered spec", () => {
  it("fails, naming Calendar, when the admin's connection wasn't granted it", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGoogle(orgA.admin.ctx, orgA.admin.email, { scopes: allBut("calendar") });

    expect(
      await issuesOf(saveWorkflow(orgA.admin.ctx, { name: "Invites", spec: inviteSpec() })),
    ).toEqual([
      {
        path: ["credentials"],
        message:
          "A member-credential workflow needs your own Google connection, allowed Calendar. Connect Google first, or reconnect it to allow Calendar.",
      },
    ]);
  });

  it("saves on a connection granted Calendar but not Gmail, where a Gmail spec fails", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGoogle(orgA.admin.ctx, orgA.admin.email, { scopes: allBut("gmail") });

    await expect(
      saveWorkflow(orgA.admin.ctx, { name: "Invites", spec: inviteSpec() }),
    ).resolves.toMatchObject({ id: expect.any(String) as string });
    const issues = await issuesOf(
      saveWorkflow(orgA.admin.ctx, { name: "Labels", spec: labelSpec() }),
    );
    expect(issues.map((issue) => issue.message)).toEqual([
      expect.stringMatching(/allowed Gmail/) as string,
    ]);
  });
});

describe("switching a Calendar-triggered workflow on", () => {
  it("asks a member whose connection wasn't allowed Calendar to reconnect, naming it", async () => {
    const { orgA } = await seedTwoOrgs();
    const { admin, member } = orgA;
    await connectGoogle(admin.ctx, admin.email);
    await tagUsers(admin.ctx, "sales", [member]);
    const { workflowId } = await publishTo(admin.ctx, "Invites", inviteSpec(), ["sales"]);
    const own = await connectGoogle(member.ctx, member.email, { scopes: allBut("calendar") });

    expect((await getVisibleWorkflow(member.ctx, workflowId)).requiredApps).toEqual(["Calendar"]);
    expect(await enable(member.ctx, workflowId)).toEqual({
      needs: "reconnect",
      connectionId: own.id,
      apps: ["Calendar"],
      scopes: ["calendar.events"],
    });
  });

  it("refuses an org connection not allowed Calendar, naming it", async () => {
    const { orgA } = await seedTwoOrgs();
    const { admin } = orgA;
    await connectGoogle(admin.ctx, "ops@org-a.test", { kind: "org" });
    const support = await connectGoogle(admin.ctx, "support@org-a.test", {
      kind: "org",
      scopes: allBut("calendar"),
    });
    const { id: workflowId } = await saveWorkflow(admin.ctx, {
      name: "Invites",
      spec: inviteSpec("org"),
    });
    await publishWorkflow(admin.ctx, workflowId);

    expect(await issuesOf(switchWorkflowOn(admin.ctx, workflowId, support.id))).toEqual([
      {
        path: ["credentials"],
        message: "support@org-a.test wasn't allowed Calendar. Reconnect it to allow Calendar.",
      },
    ]);
  });

  it("lists the trigger with what's switched on, for the fan-out", async () => {
    const { orgA } = await seedTwoOrgs();
    const { admin } = orgA;
    const own = await connectGoogle(admin.ctx, admin.email);
    const { id: workflowId } = await saveWorkflow(admin.ctx, {
      name: "Invites",
      spec: inviteSpec(),
    });
    await publishWorkflow(admin.ctx, workflowId);
    await switchWorkflowOn(admin.ctx, workflowId, own.id);

    expect(await listSwitchedOn(systemCtx(orgA.id), own.id)).toEqual([
      expect.objectContaining({ workflowId, trigger: { type: "calendar.invite_received" } }),
    ]);
  });
});

describe("a new version that changes the trigger", () => {
  it("says it now needs Calendar, and would pause members' enablements", async () => {
    const { orgA } = await seedTwoOrgs();
    const { admin, member } = orgA;
    await connectGoogle(admin.ctx, admin.email);
    await tagUsers(admin.ctx, "sales", [member]);
    await connectGoogle(member.ctx, member.email);
    const { workflowId } = await publishTo(admin.ctx, "Labels", labelSpec(), ["sales"]);
    await enable(member.ctx, workflowId);

    const onInvites = {
      ...labelSpec(),
      visibility: { tags: ["sales"] },
      trigger: { type: "calendar.invite_received" },
      steps: inviteSpec().steps,
    };

    expect(await previewPublish(admin.ctx, workflowId, onInvites)).toEqual({
      gained: { newApps: ["Calendar"] },
      pauses: 1,
    });
  });
});
