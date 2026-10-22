import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { startConversation } from "@/features/builder/server";
import { fileCapabilityRequest, listCapabilityRequests } from "@/features/custom-actions/server";
import type { Ctx } from "@/lib/ctx";
import { runCapabilityRequestsCommand, USAGE } from "../capability-requests-commands";

beforeEach(resetDatabase);

async function file(admin: Ctx, operation: string) {
  const { id } = await startConversation(admin, {});
  return fileCapabilityRequest(
    admin,
    {
      app: "HubSpot",
      operation,
      inputs: [],
      outputs: [],
      reason: "Not one call.",
      codeDraft: `// ${operation}`,
    },
    { conversationId: id },
  );
}

describe("pnpm capability-requests", () => {
  it("lists every company's requests", async () => {
    const { orgA, orgB } = await seedTwoOrgs();
    const a = await file(orgA.admin.ctx, "Merge two contacts");
    const b = await file(orgB.admin.ctx, "Close a deal");

    const { exitCode, output } = await runCapabilityRequestsCommand([]);

    expect(exitCode).toBe(0);
    expect(output).toContain(`${a.requestId}  org ${orgA.id}  open  asked 1x  HubSpot: Merge`);
    expect(output).toContain(`${b.requestId}  org ${orgB.id}  open  asked 1x  HubSpot: Close`);
  });

  it("shows one request with its code draft", async () => {
    const { orgA } = await seedTwoOrgs();
    const a = await file(orgA.admin.ctx, "Merge two contacts");

    const { output } = await runCapabilityRequestsCommand(["show", a.requestId]);

    expect(output).toContain("code draft:\n// Merge two contacts");
  });

  it("changes a status and note, which the company's admins then see", async () => {
    const { orgA, orgB } = await seedTwoOrgs();
    const b = await file(orgB.admin.ctx, "Close a deal");

    const result = await runCapabilityRequestsCommand([
      "set",
      b.requestId,
      "building",
      "Started",
      "this week.",
    ]);

    expect(result).toEqual({ exitCode: 0, output: `Request ${b.requestId} is now building.` });
    expect(await listCapabilityRequests(orgB.admin.ctx)).toEqual([
      expect.objectContaining({ status: "building", note: "Started this week." }),
    ]);
    expect(await listCapabilityRequests(orgA.admin.ctx)).toEqual([]);
  });

  it("refuses an unknown request or status, changing nothing", async () => {
    const { orgA } = await seedTwoOrgs();
    const a = await file(orgA.admin.ctx, "Merge two contacts");

    expect(await runCapabilityRequestsCommand(["set", "nope", "shipped"])).toEqual({
      exitCode: 1,
      output: "No company has a capability request nope.",
    });
    expect(await runCapabilityRequestsCommand(["set", a.requestId, "done"])).toEqual({
      exitCode: 1,
      output: USAGE,
    });
    expect(await listCapabilityRequests(orgA.admin.ctx)).toEqual([
      expect.objectContaining({ status: "open" }),
    ]);
  });
});
