import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { startConversation } from "@/features/builder/server";
import { systemCtx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import {
  fileCapabilityRequest,
  listCapabilityRequests,
  setCapabilityRequestStatus,
} from "../server";
import { fileRequest } from "./capability-request-helpers";

beforeEach(resetDatabase);

describe("listCapabilityRequests", () => {
  it("is for admins: members get ForbiddenError", async () => {
    const { orgA } = await seedTwoOrgs();
    await fileRequest(orgA.admin.ctx);

    await expect(listCapabilityRequests(orgA.member.ctx)).rejects.toThrow(ForbiddenError);
  });
});

describe("fileCapabilityRequest", () => {
  it("is for admins: a member files nothing", async () => {
    const { orgA } = await seedTwoOrgs();
    const { id } = await startConversation(orgA.admin.ctx, {});

    await expect(
      fileCapabilityRequest(
        orgA.member.ctx,
        {
          app: "google",
          operation: "Merge two contacts",
          inputs: [],
          outputs: [],
          reason: "Two calls.",
        },
        { conversationId: id },
      ),
    ).rejects.toThrow(ForbiddenError);
    expect(await listCapabilityRequests(orgA.admin.ctx)).toEqual([]);
  });
});

describe("setCapabilityRequestStatus", () => {
  it("changes the status and note our team sets, which the org's admins then see", async () => {
    const { orgA } = await seedTwoOrgs();
    const request = await fileRequest(orgA.admin.ctx);

    await setCapabilityRequestStatus(systemCtx(orgA.id), request.requestId, {
      status: "building",
      note: "Next week.",
    });

    expect(await listCapabilityRequests(orgA.admin.ctx)).toEqual([
      expect.objectContaining({ status: "building", note: "Next week.", count: 1 }),
    ]);

    // A change without a note clears the old one.
    await setCapabilityRequestStatus(systemCtx(orgA.id), request.requestId, {
      status: "shipped",
    });
    expect(await listCapabilityRequests(orgA.admin.ctx)).toEqual([
      expect.objectContaining({ status: "shipped", note: null }),
    ]);
  });

  it("is only for our team: admins and members get ForbiddenError", async () => {
    const { orgA } = await seedTwoOrgs();
    const request = await fileRequest(orgA.admin.ctx);

    for (const ctx of [orgA.admin.ctx, orgA.member.ctx]) {
      await expect(
        setCapabilityRequestStatus(ctx, request.requestId, { status: "declined" }),
      ).rejects.toThrow(ForbiddenError);
    }
    expect(await listCapabilityRequests(orgA.admin.ctx)).toEqual([
      expect.objectContaining({ status: "open" }),
    ]);
  });

  it("finds no request of another org", async () => {
    const { orgA, orgB } = await seedTwoOrgs();
    const request = await fileRequest(orgB.admin.ctx);

    await expect(
      setCapabilityRequestStatus(systemCtx(orgA.id), request.requestId, { status: "declined" }),
    ).rejects.toThrow(NotFoundError);
  });
});
