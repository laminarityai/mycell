// What a long conversation sends the model (#132): only the last 3 turns' tool results, and
// past half the `smart` role's context window, a `fast` summary of all but the last 10 turns in
// their place. The tests' `smart` window is 10,000 tokens (vitest.config.mts), so a history
// past 20,000 characters is summarized.
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { getBalance, listLedger } from "@/features/credits/server";
import { saveWorkflow } from "@/features/workflows/server";
import type { Ctx } from "@/lib/ctx";
import { connectGmail } from "@/testing/connect-helpers";
import { fakeAiGateway, type FakeGatewayRequest } from "@/testing/fake-ai-gateway";
import { fundOrg, readTurn } from "@/testing/streamed-turn";
import { getConversation, startConversation, streamTurn } from "../server";
import type { BuilderConversation } from "../types";
import { Conversation } from "../ui";
import { labelSpec } from "./specs";

beforeEach(resetDatabase);

type PromptMessage = { role: string; content: unknown };
type PromptPart = { type: string; text?: string; output?: unknown; toolName?: string };

// The messages a streamed request sent, its system prompt left out.
function sentMessages(request: FakeGatewayRequest | undefined): PromptMessage[] {
  const prompt = (request?.body.prompt ?? []) as PromptMessage[];
  return prompt.filter((message) => message.role !== "system");
}

function partsOf(messages: PromptMessage[], role: string): PromptPart[] {
  return messages.flatMap((message) =>
    message.role === role && Array.isArray(message.content)
      ? (message.content as PromptPart[])
      : [],
  );
}

const lastTurnRequest = () =>
  fakeAiGateway
    .requests("language")
    .filter((r) => r.streaming)
    .at(-1);
const summaryRequests = () => fakeAiGateway.requests("language").filter((r) => !r.streaming);

// A turn whose reply is plain text.
async function say(ctx: Ctx, conversationId: string, message: string, costUsd?: number) {
  fakeAiGateway.reply({ text: `Noted: ${message.slice(0, 20)}` }, { costUsd });
  return readTurn(await streamTurn(ctx, conversationId, message));
}

// Turn 1 is long, past the window's half by itself; turns 2 to `turns` are short.
async function longConversation(turns: number, options: { lastCostUsd?: number } = {}) {
  const { orgA } = await seedTwoOrgs();
  await fundOrg(orgA.id);
  const admin = orgA.admin.ctx;
  const { id } = await startConversation(admin, {});
  await say(admin, id, `Turn 1 question. ${"Pricing details. ".repeat(1500)}`);
  for (let n = 2; n <= turns; n += 1) {
    await say(
      admin,
      id,
      `Turn ${String(n)} question.`,
      n === turns ? options.lastCostUsd : undefined,
    );
  }
  return { orgA, admin, id };
}

describe("old tool results", () => {
  it("sends only the last 3 turns' tool results, and every call and word", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const admin = orgA.admin.ctx;
    await connectGmail(admin, orgA.admin.email);
    const workflow = await saveWorkflow(admin, { name: "Label pricing mail", spec: labelSpec() });
    const { id } = await startConversation(admin, {});
    for (let n = 1; n <= 5; n += 1) {
      fakeAiGateway.reply({
        toolCalls: [{ name: "get_workflow", input: { workflowId: workflow.id } }],
      });
      fakeAiGateway.reply({ text: `Answer ${String(n)}.` });
      await readTurn(await streamTurn(admin, id, `Question ${String(n)}?`));
    }

    await say(admin, id, "Question 6?");

    const sent = sentMessages(lastTurnRequest());
    const results = partsOf(sent, "tool").map((part) => JSON.stringify(part.output));
    expect(results).toHaveLength(5);
    for (const dropped of results.slice(0, 2)) {
      expect(dropped).not.toContain("Is this a pricing inquiry?");
      expect(dropped).toContain("dropped");
      expect(dropped).toContain("get_workflow again");
    }
    for (const kept of results.slice(2)) expect(kept).toContain("Is this a pricing inquiry?");
    expect(partsOf(sent, "assistant").filter((p) => p.type === "tool-call")).toHaveLength(5);
    const text = JSON.stringify(sent);
    for (let n = 1; n <= 6; n += 1) expect(text).toContain(`Question ${String(n)}?`);
    for (let n = 1; n <= 5; n += 1) expect(text).toContain(`Answer ${String(n)}.`);
  });
});

describe("a long conversation's summary", () => {
  it("summarizes all but the last 10 turns once, on fast, metered as the builder's", async () => {
    const { admin, id } = await longConversation(11);
    fakeAiGateway.text("The admin wants pricing questions labelled.", { costUsd: 0.004 });

    await say(admin, id, "Turn 12 question.");

    const requests = summaryRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.modelId).toBe("test/fast-default");
    const asked = JSON.stringify(requests[0]?.body);
    expect(asked).toContain("Turn 1 question.");
    expect(asked).not.toContain("Turn 2 question.");
    // The turn sent the summary in place of turn 1, then turns 2 to 11 and the new message.
    const turn = JSON.stringify(lastTurnRequest()?.body);
    expect(turn).toContain("The admin wants pricing questions labelled.");
    expect(turn).not.toContain("Turn 1 question.");
    for (let n = 2; n <= 12; n += 1) expect(turn).toContain(`Turn ${String(n)} question.`);
    const usage = (await listLedger(admin)).filter((entry) => entry.role === "fast");
    expect(usage).toEqual([
      expect.objectContaining({ purpose: "builder", costUsd: 0.004, outcome: "succeeded" }),
    ]);
  });

  it("tells the summary to keep what matters and never quote the examples", async () => {
    const { admin, id } = await longConversation(11);
    fakeAiGateway.text("Summary.");

    await say(admin, id, "Turn 12 question.");

    // The prompt's lines are wrapped, so its words are compared without the line breaks.
    const asked = JSON.stringify(summaryRequests().at(0)?.body).replace(/\\n\s*/g, " ");
    expect(asked).toContain("in your own words and never quote them");
    for (const kept of ["facts", "decisions", "the workflow being built", "open questions"]) {
      expect(asked).toContain(kept);
    }
  });

  it("sends the stored summary and the turns since on later turns, without summarizing again", async () => {
    const { admin, id } = await longConversation(11);
    fakeAiGateway.text("The admin wants pricing questions labelled.");
    await say(admin, id, "Turn 12 question.");

    await say(admin, id, "Turn 13 question.");

    expect(summaryRequests()).toHaveLength(1);
    const turn = JSON.stringify(lastTurnRequest()?.body);
    expect(turn).toContain("The admin wants pricing questions labelled.");
    expect(turn).not.toContain("Turn 1 question.");
    for (let n = 2; n <= 13; n += 1) expect(turn).toContain(`Turn ${String(n)} question.`);
  });

  it("summarizes again from the old summary when the history grows past the size again", async () => {
    const { admin, id } = await longConversation(11);
    fakeAiGateway.text("First summary.");
    await say(admin, id, "Turn 12 question.");
    // Turn 13 is long too: the next turn is past the size again, and turns 2 and 3 go.
    await say(admin, id, `Turn 13 question. ${"Invoice details. ".repeat(1500)}`);
    fakeAiGateway.text("Second summary.");

    await say(admin, id, "Turn 14 question.");

    const second = JSON.stringify(summaryRequests().at(1)?.body);
    expect(second).toContain("First summary.");
    expect(second).toContain("Turn 3 question.");
    expect(second).not.toContain("Turn 1 question.");
    expect(second).not.toContain("Turn 4 question.");
    const turn = JSON.stringify(lastTurnRequest()?.body);
    expect(turn).toContain("Second summary.");
    expect(turn).not.toContain("First summary.");
    expect(turn).not.toContain("Turn 3 question.");
    for (let n = 4; n <= 14; n += 1) expect(turn).toContain(`Turn ${String(n)} question.`);
  });

  it("still answers, unsummarized, when the summary call fails", async () => {
    const { admin, id } = await longConversation(11);
    fakeAiGateway.fail("language", { status: 500 });

    const turn = await say(admin, id, "Turn 12 question.");

    expect(turn.text).toContain("Noted");
    expect(JSON.stringify(lastTurnRequest()?.body)).toContain("Turn 1 question.");
    expect((await getConversation(admin, id)).summarizedThrough).toBeNull();
    expect((await listLedger(admin)).find((entry) => entry.role === "fast")).toMatchObject({
      purpose: "builder",
      outcome: "failed",
    });
  });

  it("calls no model out of credits, and summarizes nothing", async () => {
    // The last turn costs 0.999 USD: 999 of the 1000 credits, leaving too few for either role.
    const { admin, id } = await longConversation(11, { lastCostUsd: 0.999 });
    expect(await getBalance(admin)).toBeLessThan(5);
    const before = fakeAiGateway.requests().length;

    const turn = await readTurn(await streamTurn(admin, id, "Turn 12 question."));

    expect(fakeAiGateway.requests()).toHaveLength(before);
    expect(turn.notices.map((notice) => notice.kind)).toEqual(["out_of_credits"]);
    expect((await getConversation(admin, id)).summarizedThrough).toBeNull();
  });

  it("still shows the admin every message, with where the summary cut", async () => {
    const { admin, id } = await longConversation(11);
    fakeAiGateway.text("Summary.");
    await say(admin, id, "Turn 12 question.");

    const conversation = await getConversation(admin, id);

    expect(conversation.messages).toHaveLength(24);
    // Turn 1, the admin's message and the reply, is what was summarized.
    expect(conversation.summarizedThrough).toBe(conversation.messages[1]?.id);
    const html = renderConversation(conversation);
    for (let n = 1; n <= 12; n += 1) expect(html).toContain(`Turn ${String(n)} question.`);
    const marker = html.indexOf("Earlier messages summarized");
    expect(marker).toBeGreaterThan(html.indexOf("Turn 1 question."));
    expect(marker).toBeLessThan(html.indexOf("Turn 2 question."));
    expect(html.split("Earlier messages summarized")).toHaveLength(2);
  });

  it("marks nothing before anything is summarized", async () => {
    const { admin, id } = await longConversation(2);

    expect(renderConversation(await getConversation(admin, id))).not.toContain("summarized");
  });
});

// The conversation page's chat as the server renders it, under a router that goes nowhere.
function renderConversation(conversation: BuilderConversation): string {
  const noop = () => undefined;
  const router: AppRouterInstance = {
    back: noop,
    forward: noop,
    refresh: noop,
    push: noop,
    replace: noop,
    prefetch: noop,
    bfcacheId: "test",
  };
  return renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: router },
      createElement(Conversation, {
        conversation,
        proposals: [],
        customActions: [],
        workflow: null,
        tryIt: null,
      }),
    ),
  );
}
