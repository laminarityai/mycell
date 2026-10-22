import { expect } from "vitest";
import { readOutlookMessage, storeCustomAction } from "@/db/testing/custom-actions";
import { defineIsolationCases, notTenantScoped } from "@/db/testing/isolation";
import { systemCtx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import * as server from "../server";
import { fileRequest, MERGE_CONTACTS } from "./capability-request-helpers";

export const isolationCases = defineIsolationCases(server, {
  getActionSet: async ({ orgA, orgB }) => {
    await storeCustomAction(orgB.admin.ctx);
    await storeCustomAction(orgA.admin.ctx, readOutlookMessage({ name: "microsoft.read-mail" }));

    const custom = (await server.getActionSet(orgA.member.ctx)).actions.filter(
      (action) => action.kind === "custom",
    );
    expect(custom.map((action) => action.name)).toEqual(["microsoft.read-mail"]);
    expect((await server.getActionSet(orgA.admin.ctx)).find("microsoft.read-message")).toBe(
      undefined,
    );
  },

  lookUpAppApi: notTenantScoped(
    "It searches a registered app's published API description, the same for every org, and reads no org data.",
  ),

  listCustomActions: async ({ orgA, orgB }) => {
    await storeCustomAction(orgB.admin.ctx);

    expect(await server.listCustomActions(orgA.admin.ctx)).toEqual([]);
    expect(await server.listCustomActions(systemCtx(orgA.id))).toEqual([]);
  },

  findCustomAction: async ({ orgA, orgB }) => {
    await storeCustomAction(orgB.admin.ctx);
    const [theirs] = await server.listCustomActions(orgB.admin.ctx);

    expect(await server.findCustomAction(orgA.admin.ctx, theirs.name)).toBeNull();
    expect(await server.findCustomAction(orgB.admin.ctx, theirs.name)).toEqual(theirs);
  },

  storeCustomActions: async ({ orgA, orgB }) => {
    await storeCustomAction(orgB.admin.ctx);
    const before = await server.listCustomActions(orgB.admin.ctx);

    // The same name, doing something else, is free in org A: names are unique per company.
    const other = readOutlookMessage({ description: "Read an Outlook message's subject." });
    await storeCustomAction(orgA.admin.ctx, other);

    expect(await server.listCustomActions(orgB.admin.ctx)).toEqual(before);
    expect(await server.listCustomActions(orgA.admin.ctx)).toEqual([
      expect.objectContaining({ description: "Read an Outlook message's subject." }),
    ]);
  },

  fileCapabilityRequest: async ({ orgA, orgB }) => {
    const theirs = await fileRequest(orgB.admin.ctx);
    const before = await server.listCapabilityRequests(orgB.admin.ctx);

    // Filed from org B's conversation: not found. The same ask from org A's own is org A's.
    await expect(
      server.fileCapabilityRequest(orgA.admin.ctx, MERGE_CONTACTS, {
        conversationId: theirs.conversationId,
      }),
    ).rejects.toThrow(NotFoundError);
    await fileRequest(orgA.admin.ctx);

    expect(await server.listCapabilityRequests(orgB.admin.ctx)).toEqual(before);
    expect(await server.listCapabilityRequests(orgA.admin.ctx)).toEqual([
      expect.objectContaining({ count: 1 }),
    ]);
  },

  listCapabilityRequests: async ({ orgA, orgB }) => {
    await fileRequest(orgB.admin.ctx);

    expect(await server.listCapabilityRequests(orgA.admin.ctx)).toEqual([]);
    expect(await server.listCapabilityRequests(systemCtx(orgA.id))).toEqual([]);
  },

  setCapabilityRequestStatus: async ({ orgA, orgB }) => {
    const theirs = await fileRequest(orgB.admin.ctx);

    await expect(
      server.setCapabilityRequestStatus(systemCtx(orgA.id), theirs.requestId, {
        status: "declined",
      }),
    ).rejects.toThrow(NotFoundError);
    expect(await server.listCapabilityRequests(orgB.admin.ctx)).toEqual([
      expect.objectContaining({ status: "open" }),
    ]);
  },
});
