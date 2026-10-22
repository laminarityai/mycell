// The builder chat looking up a registered app's published API (ADR-0018), so the custom action
// it describes makes a real call: matching operations with their parameters, request and
// response fields, and what the fixed rule makes of each.
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import type { Ctx } from "@/lib/ctx";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { getConversation, startConversation, streamTurn } from "../server";
import { fundOrg, readTurn } from "./turn-helpers";

beforeEach(resetDatabase);

async function setUp() {
  const { orgA } = await seedTwoOrgs();
  await fundOrg(orgA.id);
  const admin = orgA.admin.ctx;
  const { id: conversationId } = await startConversation(admin, {});
  return { admin, conversationId };
}

/** A turn in which the agent looks up `input`, then answers. */
async function lookUp(admin: Ctx, conversationId: string, input: Record<string, unknown>) {
  fakeAiGateway.reply({ toolCalls: [{ name: "look_up_app_api", input }] });
  fakeAiGateway.reply({ text: "Found it." });
  const turn = await readTurn(await streamTurn(admin, conversationId, "Use my Outlook mail"));
  const reply = (await getConversation(admin, conversationId)).messages.at(-1);
  const part = reply?.parts.find((each) => each.type === "tool");
  return {
    turn,
    // What the model read in the turn's second step: the tool's whole result.
    sent: toolResultSent(fakeAiGateway.requests("language").at(-1)?.body),
    stored: part?.type === "tool" ? part.output : undefined,
  };
}

const sentSchema = z.object({
  prompt: z.array(
    z.object({
      role: z.string(),
      content: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]),
    }),
  ),
});

// The last tool result in a request to the model.
function toolResultSent(body: unknown): unknown {
  const results = sentSchema
    .parse(body)
    .prompt.flatMap((message) => (typeof message.content === "string" ? [] : message.content))
    .filter((part) => part.type === "tool-result");
  return z.object({ output: z.object({ value: z.unknown() }) }).parse(results.at(-1)).output.value;
}

/** The found operation with this method and path. */
function found(sent: unknown, method: string, path: string) {
  const { operations } = z
    .object({ operations: z.array(z.object({ method: z.string(), path: z.string() }).loose()) })
    .parse(sent);
  return operations.find((operation) => operation.method === method && operation.path === path);
}

describe("looking up a registered app's API", () => {
  it("finds Microsoft Graph's operations for plain words, with their inputs and fields", async () => {
    const { admin, conversationId } = await setUp();

    const { turn, sent, stored } = await lookUp(admin, conversationId, {
      app: "microsoft",
      search: "outlook messages",
      method: "GET",
    });

    expect(turn.toolCalls).toEqual(["look_up_app_api"]);
    expect(turn.toolErrors).toEqual([]);
    // The read of one message, its placeholder named as an input, from Graph's root, with its
    // response's fields.
    expect(found(sent, "GET", "/v1.0/me/messages/{messageId}")).toMatchObject({
      parameters: expect.arrayContaining([
        {
          name: "messageId",
          in: "path",
          required: true,
          type: "text",
          description: expect.any(String) as string,
        },
      ]) as unknown,
      rule: "a read: runs on its own",
      response: {
        type: "microsoft.graph.message",
        fields: expect.arrayContaining([
          expect.objectContaining({ name: "subject", type: "text" }),
          expect.objectContaining({ name: "from", type: "microsoft.graph.recipient" }),
        ]) as unknown,
      },
    });
    // A list's response, with each item's fields.
    expect(found(sent, "GET", "/v1.0/me/messages")).toMatchObject({
      response: { type: "microsoft.graph.messageCollectionResponse" },
      eachItem: { type: "microsoft.graph.message" },
    });
    // The conversation keeps only which operations it found.
    expect(stored).toMatchObject({
      app: "microsoft",
      search: "outlook messages",
      operations: expect.arrayContaining([
        {
          method: "GET",
          path: "/v1.0/me/messages/{messageId}",
          summary: expect.any(String) as string,
          rule: "a read: runs on its own",
        },
      ]) as unknown,
    });
    expect(JSON.stringify(stored)).not.toContain("subject");
  });

  it("finds Google's operations, and says a write waits for approval and a delete is refused", async () => {
    const { admin, conversationId } = await setUp();

    const { sent } = await lookUp(admin, conversationId, {
      app: "google",
      search: "append values spreadsheet",
    });

    expect(
      found(sent, "POST", "/v4/spreadsheets/{spreadsheetId}/values/{range}:append"),
    ).toMatchObject({
      rule: "a write: waits for a person's approval every time it runs",
      parameters: expect.arrayContaining([
        expect.objectContaining({ name: "valueInputOption", in: "query" }),
      ]) as unknown,
      body: { type: "sheets.ValueRange" },
    });

    const { sent: deleting } = await lookUp(admin, conversationId, {
      app: "google",
      search: "delete gmail message",
      method: "DELETE",
    });
    expect(found(deleting, "DELETE", "/gmail/v1/users/{userId}/messages/{id}")).toMatchObject({
      rule: "refused: A custom action can't delete.",
    });
  });

  it("describes a type a field names", async () => {
    const { admin, conversationId } = await setUp();

    const { sent, stored } = await lookUp(admin, conversationId, {
      app: "microsoft",
      type: "microsoft.graph.recipient",
    });

    expect(sent).toMatchObject({
      type: {
        type: "microsoft.graph.recipient",
        // Looked up by name, each field says what it holds.
        fields: expect.arrayContaining([
          {
            name: "emailAddress",
            type: "microsoft.graph.emailAddress",
            description: "The recipient's email address.",
          },
        ]) as unknown,
      },
    });
    expect(stored).toEqual({ app: "microsoft", type: "microsoft.graph.recipient" });
  });

  it("sends a malformed lookup back to the model as an error", async () => {
    const { admin, conversationId } = await setUp();

    const { turn } = await lookUp(admin, conversationId, { app: "salesforce", search: "lead" });

    expect(turn.toolErrors).toHaveLength(1);
  });
});
