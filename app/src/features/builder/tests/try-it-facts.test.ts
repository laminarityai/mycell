import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { saveWorkflow } from "@/features/workflows/server";
import { connectGoogle } from "@/testing/connect-helpers";
import { fundOrg } from "@/testing/streamed-turn";
import { getConversation, startConversation, tryInConversation } from "../server";

beforeEach(resetDatabase);

const SENDER = "Ada Lovelace <ada@customer.test>";
const SUBJECT = "Quote for 30 oak chairs";

/** Quote requests from customers get a label; anything else stops. No model step. */
const quotes = {
  specVersion: 2,
  id: "quotes",
  credentials: "member",
  trigger: { type: "gmail.message_received" },
  autonomy: { rung: 3 },
  steps: [
    {
      id: "route",
      type: "branch",
      paths: [
        {
          id: "quote",
          name: "Quote",
          condition: {
            combine: "all",
            checks: [
              { subject: { from: "trigger.subject" }, op: "contains", value: "quote" },
              { subject: { from: "trigger.senderDomain" }, op: "is", value: "supplier.test" },
            ],
          },
          steps: [
            {
              id: "label",
              type: "tool",
              action: "google-mail.add-label",
              input: { messageId: { from: "trigger.messageId" }, label: "Quote" },
            },
          ],
        },
      ],
      otherwise: { id: "rest", steps: [] },
    },
  ],
};

describe("tryInConversation on a branch that tests the message's facts", () => {
  it("shows the tested subject and sender on the page, never in the conversation", async () => {
    const { orgA } = await seedTwoOrgs();
    await fundOrg(orgA.id);
    const admin = orgA.admin.ctx;
    const google = await connectGoogle(admin, orgA.admin.email);
    const message = google.mailbox.add({
      from: SENDER,
      subject: SUBJECT,
      text: "Hello, what would 30 oak chairs cost?",
      at: new Date(Date.now() - 60_000),
    });
    const { id: workflowId } = await saveWorkflow(admin, { name: "Quotes", spec: quotes });
    const { id: conversationId } = await startConversation(admin, { workflowId });

    const { result } = await tryInConversation(admin, conversationId, {
      connectionId: google.id,
      sourceRef: message.id,
    });

    expect(JSON.stringify(result)).toContain(SUBJECT);
    const { messages } = await getConversation(admin, conversationId);
    const lines = messages.flatMap((m) =>
      m.parts.flatMap((part) => (part.type === "try_it" ? part.lines : [])),
    );
    expect(lines).toContain(
      'route, path "Quote": didn\'t apply. the subject contains "quote": passed; ' +
        `the sender's domain is "supplier.test": failed.`,
    );
    const stored = JSON.stringify(messages);
    for (const content of [SUBJECT, "Ada", "ada@", "customer.test", "oak"]) {
      expect(stored).not.toContain(content);
    }
  });
});
