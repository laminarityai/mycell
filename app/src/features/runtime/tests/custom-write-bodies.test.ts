// A custom write whose request body nests (ADR-0018): its description maps dotted body paths to
// inputs, so Graph's sendMail, a calendar event or a Teams message can be described. The held
// request is the nested body, and a reviewer's edit to a nested text field is sent as edited.
import { beforeEach, describe, expect, it } from "vitest";
import { storeCustomAction } from "@/db/testing/custom-actions";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits } from "@/features/credits/server";
import { approveEditedReview, listReviews } from "@/features/reviews/server";
import { systemCtx } from "@/lib/ctx";
import { connectApp, connectGoogle } from "@/testing/connect-helpers";
import { fakeNango } from "@/testing/fake-nango";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import { dryRun, executeRun, startRun } from "../server";

beforeEach(resetDatabase);

/** Graph's user: sendMail, with the message's subject, text and one recipient nested in it. */
const sendMail = {
  name: "microsoft.send-mail",
  app: "microsoft",
  description: "Send an email from the signed-in person's Outlook mailbox.",
  call: {
    method: "POST",
    path: "/v1.0/me/sendMail",
    body: {
      "message.subject": "subject",
      "message.body.contentType": "format",
      "message.body.content": "text",
      "message.toRecipients.0.emailAddress.address": "to",
      saveToSentItems: "keepCopy",
    },
  },
  inputs: {
    subject: { type: "text", description: "The email's subject." },
    format: { type: "choice", description: "Text or HTML.", choices: ["Text", "HTML"] },
    text: { type: "text", description: "The email's text." },
    to: { type: "text", description: "The recipient's address." },
    keepCopy: { type: "yes_no", description: "Keep a copy in Sent Items.", optional: true },
  },
  editable: ["text"],
};

const spec = {
  specVersion: 2,
  id: "outlook-mail",
  credentials: "member",
  trigger: { type: "gmail.message_received" },
  autonomy: { rung: 3 },
  steps: [
    {
      id: "read",
      type: "tool",
      action: "google-mail.read-message",
      input: { messageId: { from: "trigger.messageId" } },
    },
    {
      id: "mail",
      type: "tool",
      action: "microsoft.send-mail",
      input: {
        subject: "Your quote",
        format: "Text",
        text: { from: "read.body" },
        to: "ada@customer.test",
      },
    },
  ],
};

const mailed = (text: string) => ({
  message: {
    subject: "Your quote",
    body: { contentType: "Text", content: text },
    toRecipients: [{ emailAddress: { address: "ada@customer.test" } }],
  },
});

async function heldMail() {
  const { orgA } = await seedTwoOrgs();
  const admin = orgA.admin.ctx;
  const system = systemCtx(orgA.id);
  await grantCredits(system, 100);
  const google = await connectGoogle(admin, orgA.admin.email);
  const microsoft = await connectApp(admin, "microsoft", orgA.admin.email);
  const outlook = fakeNango.microsoft(microsoft.connectionId);
  await storeCustomAction(admin, sendMail);
  await tagUsers(admin, "sales", [orgA.member]);
  const { workflowId } = await publishTo(admin, "Outlook mail", spec, ["sales"]);
  const message = google.mailbox.add({
    from: "Ada Lovelace <ada@customer.test>",
    subject: "Quote for 30 oak chairs",
    text: "30 oak chairs come to 2,400 GBP.",
    at: new Date(Date.now() - 60 * 1000),
  });
  const { runId } = await startRun(admin, workflowId, google.id, message.id);
  await executeRun(system, runId);
  return { admin, google, message, outlook };
}

describe("a custom write with a nested body", () => {
  it("shows the nested request in Try it", async () => {
    const { admin, google, message } = await heldMail();

    const result = await dryRun(admin, spec, { connectionId: google.id, sourceRef: message.id });

    expect(result.steps.at(1)?.effect).toMatchObject({
      kind: "request",
      method: "POST",
      url: "https://graph.microsoft.com/v1.0/me/sendMail",
      body: mailed("30 oak chairs come to 2,400 GBP."),
    });
  });

  it("sends Graph the nested body once approved, with the reviewer's edit to its text", async () => {
    const { admin, outlook } = await heldMail();
    const [review] = await listReviews(admin);

    await approveEditedReview(admin, review.id, {
      fields: { text: "30 oak chairs come to 2,300 GBP." },
    });

    expect(outlook.requests.filter((request) => request.method !== "GET")).toEqual([
      {
        method: "POST",
        path: "/v1.0/me/sendMail",
        query: {},
        body: mailed("30 oak chairs come to 2,300 GBP."),
      },
    ]);
  });
});
