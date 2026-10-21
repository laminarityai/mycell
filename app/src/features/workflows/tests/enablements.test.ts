// Members switching workflows on and off for their own Google connection (M5).
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { disconnect } from "@/features/connections/server";
import { GOOGLE_APP_SCOPES } from "@/features/connections/types";
import { removeUser } from "@/features/orgs/server";
import { connectGmail, connectGoogle } from "@/testing/connect-helpers";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { disable, enable, getVisibleWorkflow, listEnablements, switchWorkflowOn } from "../server";
import { labelSpec, sheetSpec } from "./specs";

const allBut = (app: keyof typeof GOOGLE_APP_SCOPES) =>
  Object.entries(GOOGLE_APP_SCOPES).flatMap(([name, scope]) => (name === app ? [] : [scope]));

beforeEach(resetDatabase);

// Org A: the member has `sales`, and a label workflow is published to it.
async function publishedToSales(spec = labelSpec()) {
  const orgs = await seedTwoOrgs();
  const { admin, member } = orgs.orgA;
  await connectGmail(admin.ctx, admin.email);
  await tagUsers(admin.ctx, "sales", [member]);
  const { workflowId } = await publishTo(admin.ctx, "Labels", spec, ["sales"]);
  return { ...orgs, admin, member, workflowId };
}

describe("enabling a member workflow", () => {
  it("asks a member with no Google connection to connect one", async () => {
    const { member, workflowId } = await publishedToSales();

    expect(await enable(member.ctx, workflowId)).toEqual({
      needs: "connect",
      apps: ["Gmail"],
      scopes: ["gmail.modify"],
    });
  });

  it("asks a member whose connection wasn't allowed Gmail to reconnect it, naming it", async () => {
    const { member, workflowId } = await publishedToSales();
    const own = await connectGoogle(member.ctx, member.email, { scopes: allBut("gmail") });

    expect(await enable(member.ctx, workflowId)).toEqual({
      needs: "reconnect",
      connectionId: own.id,
      apps: ["Gmail"],
      scopes: ["gmail.modify"],
    });
    expect((await getVisibleWorkflow(member.ctx, workflowId)).switch).toBeNull();
  });

  it("asks for Sheets by app, even when Drive's scope would let it read", async () => {
    const { member, workflowId } = await publishedToSales(sheetSpec());
    const own = await connectGoogle(member.ctx, member.email, { scopes: allBut("sheets") });

    expect(await enable(member.ctx, workflowId)).toEqual({
      needs: "reconnect",
      connectionId: own.id,
      apps: ["Sheets"],
      scopes: ["spreadsheets"],
    });
  });

  it("switches it on for the member's own connection when it allows everything", async () => {
    const { member, workflowId } = await publishedToSales();
    const own = await connectGoogle(member.ctx, member.email);

    expect(await enable(member.ctx, workflowId)).toEqual({ enabled: true });

    expect((await getVisibleWorkflow(member.ctx, workflowId)).switch).toMatchObject({
      kind: "member",
      connectionId: own.id,
      status: "on",
      needsReconnect: false,
    });
  });
});

describe("who may switch what", () => {
  it("refuses a workflow the member can't see as not found", async () => {
    const { admin, member } = await publishedToSales();
    await connectGoogle(member.ctx, member.email);
    const hidden = await publishTo(admin.ctx, "Hidden", labelSpec({ id: "hidden" }), []);

    await expect(enable(member.ctx, hidden.workflowId)).rejects.toThrow(NotFoundError);
  });

  it("refuses a member the org switch of an org workflow; an admin sets it", async () => {
    const { admin, member } = await publishedToSales();
    await connectGoogle(member.ctx, member.email);
    const support = await connectGoogle(admin.ctx, "support@org-a.test", { kind: "org" });
    const shared = await publishTo(
      admin.ctx,
      "Shared",
      labelSpec({ id: "shared", credentials: "org" }),
      ["sales"],
    );

    await expect(enable(member.ctx, shared.workflowId)).rejects.toThrow(ForbiddenError);
    await expect(switchWorkflowOn(member.ctx, shared.workflowId, support.id)).rejects.toThrow(
      ForbiddenError,
    );
    await switchWorkflowOn(admin.ctx, shared.workflowId, support.id);

    expect((await getVisibleWorkflow(member.ctx, shared.workflowId)).switch).toMatchObject({
      kind: "org",
      status: "on",
    });
    expect(await listEnablements(admin.ctx, shared.workflowId)).toEqual([]);
  });

  it("shows only admins who has a workflow on", async () => {
    const { member, workflowId } = await publishedToSales();

    await expect(listEnablements(member.ctx, workflowId)).rejects.toThrow(ForbiddenError);
  });
});

describe("enabling twice and disabling", () => {
  it("enabling twice leaves one enablement, on since the first", async () => {
    const { admin, member, workflowId } = await publishedToSales();
    await connectGoogle(member.ctx, member.email);

    await enable(member.ctx, workflowId);
    const first = (await getVisibleWorkflow(member.ctx, workflowId)).switch;
    await enable(member.ctx, workflowId);

    expect((await getVisibleWorkflow(member.ctx, workflowId)).switch).toEqual(first);
    expect(await listEnablements(admin.ctx, workflowId)).toEqual([
      {
        userId: member.id,
        name: expect.any(String) as string,
        status: "on",
        pausedReason: null,
        since: first?.since,
      },
    ]);
  });

  it("disabling removes the enablement", async () => {
    const { admin, member, workflowId } = await publishedToSales();
    await connectGoogle(member.ctx, member.email);
    await enable(member.ctx, workflowId);

    await disable(member.ctx, workflowId);

    expect((await getVisibleWorkflow(member.ctx, workflowId)).switch).toBeNull();
    expect(await listEnablements(admin.ctx, workflowId)).toEqual([]);
  });

  it("disconnecting the connection deletes the enablement", async () => {
    const { admin, member, workflowId } = await publishedToSales();
    const own = await connectGoogle(member.ctx, member.email);
    await enable(member.ctx, workflowId);

    await disconnect(member.ctx, own.id);

    expect(await listEnablements(admin.ctx, workflowId)).toEqual([]);
  });

  it("removing the user deletes the enablement", async () => {
    const { admin, member, workflowId } = await publishedToSales();
    await connectGoogle(member.ctx, member.email);
    await enable(member.ctx, workflowId);

    await removeUser(admin.ctx, member.id);

    expect(await listEnablements(admin.ctx, workflowId)).toEqual([]);
  });
});
