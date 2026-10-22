import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { listCapabilityRequests } from "@/features/custom-actions/server";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { getConversation, startConversation, streamTurn } from "../server";
import { fundOrg, readTurn } from "./turn-helpers";

beforeEach(resetDatabase);

const MERGE_CONTACTS = {
  app: "microsoft",
  operation: "Merge two contacts",
  inputs: [
    { name: "keep", description: "The contact to keep" },
    { name: "merge", description: "The contact merged into it" },
  ],
  outputs: [{ name: "contactId", description: "The merged contact" }],
  reason: "Merging reads both contacts, copies the missing fields, then deletes one.",
  codeDraft: "const a = await get(keep);\nconst b = await get(merge);\nawait patch(a, b);",
};

/** One admin turn in which the agent files `request`, then says so. */
async function fileInTurn(admin: Parameters<typeof streamTurn>[0], request: object) {
  const { id } = await startConversation(admin, {});
  fakeAiGateway.reply({ toolCalls: [{ name: "file_capability_request", input: request }] });
  fakeAiGateway.reply({ text: "I can't merge contacts yet, so I've asked our team." });
  const turn = await readTurn(await streamTurn(admin, id, "Merge duplicate contacts"));
  return { conversationId: id, turn };
}

describe("file_capability_request", () => {
  it("files a request, with its code draft, that the org's admins see", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const admin = orgA.admin.ctx;

    const { conversationId, turn } = await fileInTurn(admin, MERGE_CONTACTS);

    expect(turn.toolErrors).toEqual([]);
    expect(await listCapabilityRequests(admin)).toEqual([
      expect.objectContaining({
        app: { id: "microsoft", name: "Microsoft 365" },
        operation: "Merge two contacts",
        inputs: MERGE_CONTACTS.inputs,
        outputs: MERGE_CONTACTS.outputs,
        reason: MERGE_CONTACTS.reason,
        codeDraft: MERGE_CONTACTS.codeDraft,
        count: 1,
        conversationIds: [conversationId],
        status: "open",
        note: null,
      }),
    ]);
    // The agent is told it was filed, and the conversation keeps the call.
    const toolResult = JSON.stringify(fakeAiGateway.requests("language").at(-1)?.body);
    expect(toolResult).toContain("Filed: our team will see it.");
    const reply = (await getConversation(admin, conversationId)).messages.at(-1);
    expect(reply?.parts).toContainEqual(
      expect.objectContaining({ toolName: "file_capability_request", isError: false }),
    );
  });

  it("keeps one request for the same ask twice, counting 2 with both conversations", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const admin = orgA.admin.ctx;

    const first = await fileInTurn(admin, MERGE_CONTACTS);
    // The same app and operation, worded a little differently, without a code draft.
    const second = await fileInTurn(admin, {
      ...MERGE_CONTACTS,
      app: "Microsoft 365",
      operation: "merge  two contacts",
      codeDraft: undefined,
    });

    const requests = await listCapabilityRequests(admin);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      count: 2,
      conversationIds: [first.conversationId, second.conversationId],
      // A later ask without a draft keeps the earlier one.
      codeDraft: MERGE_CONTACTS.codeDraft,
    });
    expect(JSON.stringify(fakeAiGateway.requests("language").at(-1)?.body)).toContain(
      "asked for 2 times",
    );
  });

  it("files a request for an app that isn't registered, by its name", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const admin = orgA.admin.ctx;

    await fileInTurn(admin, { ...MERGE_CONTACTS, app: "HubSpot" });

    expect(await listCapabilityRequests(admin)).toEqual([
      expect.objectContaining({ app: { id: null, name: "HubSpot" } }),
    ]);
  });

  it("returns a malformed request to the model as an error and stores nothing", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const admin = orgA.admin.ctx;

    const { turn } = await fileInTurn(admin, { ...MERGE_CONTACTS, operation: "", reason: 42 });

    expect(turn.toolErrors).toEqual(["That tool call failed."]);
    expect(await listCapabilityRequests(admin)).toEqual([]);
  });
});
