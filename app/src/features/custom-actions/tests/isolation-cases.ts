import { expect } from "vitest";
import { defineIsolationCases, notTenantScoped } from "@/db/testing/isolation";
import { systemCtx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import * as server from "../server";
import { fileRequest, MERGE_CONTACTS } from "./capability-request-helpers";

export const isolationCases = defineIsolationCases(server, {
  getActionSet: notTenantScoped(
    "Until custom actions are stored, every company's action set is the catalog, reading nothing.",
  ),

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
