// Publishing a new version of a workflow members have switched on (M5): enablements follow it,
// unless it's riskier or needs an app or scope the previous version didn't. Then each one
// pauses until its member enables it again, and the publish dialog says so first.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { GOOGLE_APP_SCOPES } from "@/features/connections/types";
import { ForbiddenError } from "@/lib/errors";
import type { Ctx } from "@/lib/ctx";
import { connectGoogle } from "@/testing/connect-helpers";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import {
  enable,
  getVisibleWorkflow,
  getWorkflow,
  listEnablements,
  previewPublish,
  publishWorkflow,
  saveWorkflow,
  switchWorkflowOn,
} from "../server";
import { labelSpec } from "./specs";

beforeEach(resetDatabase);

const allBut = (app: keyof typeof GOOGLE_APP_SCOPES) =>
  Object.entries(GOOGLE_APP_SCOPES).flatMap(([name, scope]) => (name === app ? [] : [scope]));

const classify = (question: string) => ({
  id: "classify",
  type: "classify",
  role: "classify",
  question,
  labels: ["yes", "no"],
});
const label = {
  id: "label",
  type: "tool",
  action: "google-mail.add-label",
  input: { messageId: { from: "trigger.messageId" }, label: "Pricing" },
};
const reply = {
  id: "reply",
  type: "draft",
  role: "smart",
  instructions: "Reply with our current prices.",
  context: ["trigger.message"],
  output: "google-mail.create-draft",
};
const prices = {
  id: "prices",
  type: "tool",
  action: "google-sheet.read-range",
  input: { spreadsheetId: "sheet-1", range: "Prices!A1:C50" },
};

// Org A: the member has `sales`, a label workflow is published to it, and both the member and
// the admin have it switched on for their own Google connection. The member's connection
// wasn't allowed Sheets.
async function bothEnabled() {
  const { orgA } = await seedTwoOrgs();
  const { admin, member } = orgA;
  await connectGoogle(admin.ctx, admin.email);
  const memberInbox = await connectGoogle(member.ctx, member.email, { scopes: allBut("sheets") });
  await tagUsers(admin.ctx, "sales", [member]);
  const { workflowId } = await publishTo(admin.ctx, "Labels", labelSpec(), ["sales"]);
  await enable(member.ctx, workflowId);
  await enable(admin.ctx, workflowId);
  return { orgA, admin, member, memberInbox, workflowId };
}

/** Saves `steps` as the workflow's working spec, still published to `sales`. */
function withSteps(steps: unknown[]) {
  return labelSpec({ steps, visibility: { tags: ["sales"] } });
}

async function publishSteps(admin: Ctx, workflowId: string, steps: unknown[]) {
  await saveWorkflow(admin, { workflowId, name: "Labels", spec: withSteps(steps) });
  return publishWorkflow(admin, workflowId);
}

const statuses = async (admin: Ctx, workflowId: string) =>
  (await listEnablements(admin, workflowId)).map((one) => [one.status, one.pausedReason]);

describe("publishing a version that needs nothing new", () => {
  it("keeps every enablement on, following the new version", async () => {
    const { admin, member, workflowId } = await bothEnabled();

    const version = await publishSteps(admin.ctx, workflowId, [
      classify("Is this asking about prices?"),
      label,
    ]);

    expect(version.number).toBe(2);
    expect(await statuses(admin.ctx, workflowId)).toEqual([
      ["on", null],
      ["on", null],
    ]);
    expect(await getVisibleWorkflow(member.ctx, workflowId)).toMatchObject({
      versionNumber: 2,
      switch: { status: "on", pausedChange: null },
    });
  });
});

describe("publishing a riskier version", () => {
  it("pauses every enablement, saying the max risk went up", async () => {
    const { admin, member, workflowId } = await bothEnabled();

    await publishSteps(admin.ctx, workflowId, [
      classify("Is this a pricing inquiry?"),
      label,
      reply,
    ]);

    expect(await statuses(admin.ctx, workflowId)).toEqual([
      ["paused", "needs_reenable"],
      ["paused", "needs_reenable"],
    ]);
    expect((await getVisibleWorkflow(member.ctx, workflowId)).switch).toMatchObject({
      status: "paused",
      pausedReason: "needs_reenable",
      pausedChange: { maxRiskRaised: { from: "internal_reversible", to: "external_send" } },
    });
  });

  it("switches a paused enablement back on when its member enables it again", async () => {
    const { admin, member, workflowId } = await bothEnabled();
    await publishSteps(admin.ctx, workflowId, [
      classify("Is this a pricing inquiry?"),
      label,
      reply,
    ]);

    expect(await enable(member.ctx, workflowId)).toEqual({ enabled: true });

    expect((await getVisibleWorkflow(member.ctx, workflowId)).switch).toMatchObject({
      status: "on",
      pausedReason: null,
      pausedChange: null,
    });
    expect(await statuses(admin.ctx, workflowId)).toEqual([
      ["paused", "needs_reenable"],
      ["on", null],
    ]);
  });

  it("adds what a later version gains to what an enablement is already paused for", async () => {
    const { admin, member, workflowId } = await bothEnabled();
    await publishSteps(admin.ctx, workflowId, [
      classify("Is this a pricing inquiry?"),
      label,
      reply,
    ]);

    await publishSteps(admin.ctx, workflowId, [
      classify("Is this a pricing inquiry?"),
      prices,
      label,
      reply,
    ]);

    expect((await getVisibleWorkflow(member.ctx, workflowId)).switch?.pausedChange).toEqual({
      maxRiskRaised: { from: "internal_reversible", to: "external_send" },
      newApps: ["Sheets"],
      newScopes: ["drive.readonly"],
    });
  });
});

describe("publishing a version that reads a new app", () => {
  it("pauses with the new app, and re-enabling asks the member to reconnect for Sheets", async () => {
    const { admin, member, memberInbox, workflowId } = await bothEnabled();

    await publishSteps(admin.ctx, workflowId, [
      classify("Is this a pricing inquiry?"),
      prices,
      label,
    ]);

    expect((await getVisibleWorkflow(member.ctx, workflowId)).switch).toMatchObject({
      status: "paused",
      pausedReason: "needs_reenable",
      pausedChange: { newApps: ["Sheets"], newScopes: ["drive.readonly"] },
    });
    expect(await enable(member.ctx, workflowId)).toEqual({
      needs: "reconnect",
      connectionId: memberInbox.id,
      apps: ["Sheets"],
      scopes: ["spreadsheets"],
    });
    expect((await getVisibleWorkflow(member.ctx, workflowId)).switch?.status).toBe("paused");
  });
});

describe("previewing a publish", () => {
  it("counts the enablements publishing would pause, as many as publishing then pauses", async () => {
    const { admin, workflowId } = await bothEnabled();
    const riskier = withSteps([classify("Is this a pricing inquiry?"), label, reply]);

    const preview = await previewPublish(admin.ctx, workflowId, riskier);
    await saveWorkflow(admin.ctx, { workflowId, name: "Labels", spec: riskier });
    await publishWorkflow(admin.ctx, workflowId);

    expect(preview).toEqual({
      gained: { maxRiskRaised: { from: "internal_reversible", to: "external_send" } },
      pauses: 2,
    });
    const paused = (await listEnablements(admin.ctx, workflowId)).filter(
      (one) => one.status === "paused",
    );
    expect(paused).toHaveLength(preview.pauses);
  });

  it("finds nothing to pause for a version that needs nothing new", async () => {
    const { admin, workflowId } = await bothEnabled();

    expect(
      await previewPublish(
        admin.ctx,
        workflowId,
        withSteps([classify("Is this asking about prices?"), label]),
      ),
    ).toEqual({ gained: null, pauses: 0 });
  });

  it("is for admins only", async () => {
    const { member, workflowId } = await bothEnabled();

    await expect(previewPublish(member.ctx, workflowId, withSteps([label]))).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("an org-credential workflow", () => {
  it("keeps its org switch on across a riskier version", async () => {
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    const support = await connectGoogle(admin, "support@org-a.test", { kind: "org" });
    const spec = labelSpec({ id: "shared", credentials: "org" });
    const { workflowId } = await publishTo(admin, "Shared", spec, []);
    await switchWorkflowOn(admin, workflowId, support.id);
    const riskier = { ...spec, steps: [classify("Is this a pricing inquiry?"), label, reply] };

    const preview = await previewPublish(admin, workflowId, riskier);
    await saveWorkflow(admin, { workflowId, name: "Shared", spec: riskier });
    await publishWorkflow(admin, workflowId);

    expect(preview.pauses).toBe(0);
    expect((await getWorkflow(admin, workflowId)).switch).toMatchObject({
      kind: "org",
      connectionId: support.id,
      status: "on",
    });
  });
});
