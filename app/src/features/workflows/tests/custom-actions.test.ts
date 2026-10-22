// Custom actions in workflows (ADR-0018): saving, publishing and M5's version rules treat them
// like catalog actions, and a custom action in a registered app other than Google needs a
// connection to that app of the kind the credentials name.
import { beforeEach, describe, expect, it } from "vitest";
import {
  checkedCustomAction,
  readOutlookMessage,
  replyToOutlookMessage,
  storeCustomAction,
} from "@/db/testing/custom-actions";
import { heldReplySpec } from "@/db/testing/held-sends";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { GOOGLE_APP_SCOPES } from "@/features/connections/types";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { connectApp, connectGoogle } from "@/testing/connect-helpers";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import {
  archiveWorkflow,
  enable,
  getVisibleWorkflow,
  getWorkflow,
  listEnablements,
  publishWorkflow,
  saveWorkflow,
  workflowsUsingActions,
} from "../server";
import { labelSpec } from "./specs";

beforeEach(resetDatabase);

const label = {
  id: "label",
  type: "tool",
  action: "google-mail.add-label",
  input: { messageId: { from: "trigger.messageId" }, label: "Pricing" },
};
const outlook = {
  id: "outlook",
  type: "tool",
  action: "microsoft.read-message",
  input: { messageId: "AAMk-1" },
};

const withSteps = (steps: unknown[]) => labelSpec({ steps, visibility: { tags: ["sales"] } });

// Org A's admin has Google and Microsoft 365, and the custom read; the member has `sales` and
// their own Google account, and has the label workflow published to `sales` switched on.
async function memberEnabled() {
  const { orgA } = await seedTwoOrgs();
  const { admin, member } = orgA;
  await connectGoogle(admin.ctx, admin.email);
  await connectApp(admin.ctx, "microsoft", admin.email);
  await storeCustomAction(admin.ctx, readOutlookMessage());
  await connectGoogle(member.ctx, member.email);
  await tagUsers(admin.ctx, "sales", [member]);
  const { workflowId } = await publishTo(admin.ctx, "Labels", withSteps([label]), ["sales"]);
  await enable(member.ctx, workflowId);
  return { orgA, admin, member, workflowId };
}

describe("a custom read in a workflow", () => {
  it("saves at the level the rule set, as a step in its app", async () => {
    const { admin } = await memberEnabled();

    const { id } = await saveWorkflow(admin.ctx, {
      name: "Outlook",
      spec: labelSpec({ id: "outlook", steps: [outlook] }),
    });

    expect((await getWorkflow(admin.ctx, id)).maxRisk).toBe("read");
  });

  it("isn't saved without a connection to its app", async () => {
    const { orgA } = await seedTwoOrgs();
    await connectGoogle(orgA.admin.ctx, orgA.admin.email);
    await storeCustomAction(orgA.admin.ctx, readOutlookMessage());

    await expect(
      saveWorkflow(orgA.admin.ctx, { name: "Outlook", spec: labelSpec({ steps: [outlook] }) }),
    ).rejects.toMatchObject({
      issues: [
        {
          path: ["credentials"],
          message:
            "This workflow uses Microsoft 365, so it needs your own Microsoft 365 connection. Connect Microsoft 365 first.",
        },
      ],
    });
  });

  it("pauses members' enablements when a new version starts using its app", async () => {
    const { admin, member, workflowId } = await memberEnabled();

    await saveWorkflow(admin.ctx, {
      workflowId,
      name: "Labels",
      spec: withSteps([outlook, label]),
    });
    await publishWorkflow(admin.ctx, workflowId);

    expect((await listEnablements(admin.ctx, workflowId)).map((one) => one.status)).toEqual([
      "paused",
    ]);
    expect((await getVisibleWorkflow(member.ctx, workflowId)).switch).toMatchObject({
      status: "paused",
      pausedChange: { newApps: ["Microsoft 365"] },
    });
    // Enabling again needs the member's own Microsoft 365 first.
    await expect(enable(member.ctx, workflowId)).rejects.toThrow(ValidationError);
    await connectApp(member.ctx, "microsoft", member.email);
    expect(await enable(member.ctx, workflowId)).toEqual({ enabled: true });
  });
});

describe("a custom write in a workflow", () => {
  const reply = {
    id: "reply",
    type: "tool",
    action: "microsoft.reply-to-message",
    input: { messageId: "AAMk-1", comment: "Thanks, we'll be in touch." },
  };

  it("pauses members' enablements when a new version starts using it in an app they have", async () => {
    const { admin, member, workflowId } = await memberEnabled();
    const publish = async (steps: unknown[]) => {
      await saveWorkflow(admin.ctx, { workflowId, name: "Labels", spec: withSteps(steps) });
      await publishWorkflow(admin.ctx, workflowId);
    };
    await connectApp(member.ctx, "microsoft", member.email);
    await publish([outlook, label]);
    expect(await enable(member.ctx, workflowId)).toEqual({ enabled: true });
    await storeCustomAction(admin.ctx, replyToOutlookMessage());

    await publish([outlook, label, reply]);

    const { switch: paused } = await getVisibleWorkflow(member.ctx, workflowId);
    expect(paused?.status).toBe("paused");
    // Only the level rose: Microsoft 365 was already in use.
    expect(paused?.pausedChange).toEqual({
      maxRiskRaised: { from: expect.any(String) as string, to: "external_send" },
    });
  });
});

describe("a custom Google read in a workflow", () => {
  // Custom reads in Gmail and in Calendar, both through the run's own Google connection.
  const googleRead = (name: string, path: string) => ({
    name,
    app: "google",
    description: "Read one thing.",
    call: { method: "GET", path },
    inputs: { id: { type: "text", description: "Its ID." } },
    outputs: { title: { type: "text", label: "Its title", path: "summary" } },
  });
  const step = (id: string, action: string) => ({
    id,
    type: "tool",
    action,
    input: { id: "x-1" },
  });
  const gmailRead = step("label-info", "google.read-label");
  const calendarRead = step("event", "google.read-event");

  it("isn't saved when the connection it would run on wasn't allowed its Google app", async () => {
    const { orgA } = await seedTwoOrgs();
    const { admin } = orgA;
    await connectGoogle(admin.ctx, admin.email, { scopes: [GOOGLE_APP_SCOPES.gmail] });
    await storeCustomAction(
      admin.ctx,
      googleRead("google.read-event", "/calendar/v3/calendars/primary/events/{id}"),
    );

    await expect(
      saveWorkflow(admin.ctx, { name: "Events", spec: labelSpec({ steps: [calendarRead] }) }),
    ).rejects.toMatchObject({
      issues: [
        {
          path: ["steps", 0, "action"],
          message: `google.read-event needs the calendar.events scope, which ${admin.email} wasn't granted. Reconnect it to grant it.`,
        },
      ],
    });
  });

  it("needs its Google app's permission: a version adding one pauses members, who reconnect", async () => {
    const { orgA } = await seedTwoOrgs();
    const { admin, member } = orgA;
    await connectGoogle(admin.ctx, admin.email);
    await storeCustomAction(
      admin.ctx,
      googleRead("google.read-label", "/gmail/v1/users/me/labels/{id}"),
    );
    await storeCustomAction(
      admin.ctx,
      googleRead("google.read-event", "/calendar/v3/calendars/primary/events/{id}"),
    );
    // The member allowed Gmail only.
    const own = await connectGoogle(member.ctx, member.email, {
      scopes: [GOOGLE_APP_SCOPES.gmail],
    });
    await tagUsers(admin.ctx, "sales", [member]);
    const { workflowId } = await publishTo(admin.ctx, "Labels", withSteps([label, gmailRead]), [
      "sales",
    ]);
    expect(await enable(member.ctx, workflowId)).toEqual({ enabled: true });

    await saveWorkflow(admin.ctx, {
      workflowId,
      name: "Labels",
      spec: withSteps([label, gmailRead, calendarRead]),
    });
    await publishWorkflow(admin.ctx, workflowId);

    expect((await getVisibleWorkflow(member.ctx, workflowId)).switch).toMatchObject({
      status: "paused",
      pausedChange: { newScopes: ["calendar.events"] },
    });
    expect(await enable(member.ctx, workflowId)).toEqual({
      needs: "reconnect",
      connectionId: own.id,
      apps: ["Calendar"],
      scopes: ["calendar.events"],
    });
  });
});

describe("custom actions a save brings, as accepting a proposal does", () => {
  async function adminWithApps() {
    const { orgA } = await seedTwoOrgs();
    await connectGoogle(orgA.admin.ctx, orgA.admin.email);
    await connectApp(orgA.admin.ctx, "microsoft", orgA.admin.email);
    return orgA.admin.ctx;
  }

  it("are checked again, so the spec is validated at the level the rule sets now", async () => {
    const admin = await adminWithApps();
    // The proposal row's stored level, from before a rule change or simply wrong.
    const stale = { ...checkedCustomAction(replyToOutlookMessage()), risk: "read" as const };

    const saved = await saveWorkflow(admin, {
      name: "Outlook replies",
      spec: heldReplySpec(),
      newCustomActions: { actions: [stale], proposalId: "proposal-1" },
    });

    expect(saved.maxRisk).toBe("external_send");
    expect(saved.inserted).toEqual([
      { stepId: "reply-approval", after: "reply", action: "microsoft.reply-to-message" },
    ]);
  });

  it("are refused when the stored record isn't a custom action", async () => {
    const admin = await adminWithApps();
    const malformed = { name: "microsoft.reply-to-message", risk: "read" } as never;

    await expect(
      saveWorkflow(admin, {
        name: "Outlook replies",
        spec: heldReplySpec(),
        newCustomActions: { actions: [malformed], proposalId: "proposal-1" },
      }),
    ).rejects.toThrow(ValidationError);
  });
});

describe("which workflows use an action", () => {
  // On the otherwise path of a branch on the message's kind.
  const onAPath = labelSpec({
    id: "sorted",
    specVersion: 2,
    steps: [
      {
        id: "kind",
        type: "classify",
        role: "classify",
        question: "What kind of message is this?",
        labels: ["pricing", "other"],
      },
      {
        id: "route",
        type: "branch",
        mode: "first",
        paths: [
          {
            id: "pricing",
            name: "Pricing",
            condition: { combine: "all", checks: [{ classify: "kind", is: "pricing", minP: 0.8 }] },
            steps: [label],
          },
        ],
        otherwise: { id: "rest", steps: [outlook] },
      },
    ],
  });

  it("names each workflow whose working spec or published version uses it, at any depth", async () => {
    const { admin, workflowId: labels } = await memberEnabled();
    // Labels: published without it, then its working spec starts using it.
    await saveWorkflow(admin.ctx, {
      workflowId: labels,
      name: "Labels",
      spec: withSteps([outlook, label]),
    });
    // Sorted: published using it on a path.
    const sorted = await saveWorkflow(admin.ctx, { name: "Sorted", spec: onAPath });
    await publishWorkflow(admin.ctx, sorted.id);
    // Old: published using it, then its working spec stops, then it's archived.
    const old = await saveWorkflow(admin.ctx, {
      name: "Old",
      spec: labelSpec({ id: "old", steps: [outlook] }),
    });
    await publishWorkflow(admin.ctx, old.id);
    const stopped = labelSpec({ id: "old" });
    await saveWorkflow(admin.ctx, { workflowId: old.id, name: "Old", spec: stopped });
    await archiveWorkflow(admin.ctx, old.id);

    const uses = await workflowsUsingActions(admin.ctx, [
      "microsoft.read-message",
      "microsoft.read-mail",
    ]);

    const use = (workflowId: string, name: string) => ({ workflowId, name, archived: false });
    expect(uses.get("microsoft.read-message")).toEqual([
      { ...use(labels, "Labels"), inWorkingSpec: true, publishedVersion: null },
      { ...use(old.id, "Old"), archived: true, inWorkingSpec: false, publishedVersion: 1 },
      { ...use(sorted.id, "Sorted"), inWorkingSpec: true, publishedVersion: 1 },
    ]);
    expect(uses.get("microsoft.read-mail")).toEqual([]);
  });

  it("is for admins only, since working specs are", async () => {
    const { member } = await memberEnabled();

    await expect(workflowsUsingActions(member.ctx, ["microsoft.read-message"])).rejects.toThrow(
      ForbiddenError,
    );
  });
});
