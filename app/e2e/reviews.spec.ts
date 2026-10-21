import { randomUUID } from "node:crypto";
import { seedGoogleConnection } from "@/db/testing/seed-connection";
import { createReview } from "@/features/reviews/server";
import { publishWorkflow, saveWorkflow } from "@/features/workflows/server";
import { systemCtx } from "@/lib/ctx";
import { googleScope } from "@/lib/google";
import { expect, test } from "./fixtures";

const QUESTION = "Hello, what would 30 oak chairs cost delivered to Leeds?";
const REPLY = "Thanks Ada. 30 oak chairs come to 2,400 GBP, delivered in 5 days.";
const EDITED = "Thanks Ada. 30 oak chairs are 2,400 GBP, delivered to Leeds on Friday.";

// A member-credential workflow that drafts a reply and waits for its review.
const REPLY_SPEC = {
  specVersion: 2,
  id: "pricing-replies",
  credentials: "member",
  trigger: { type: "gmail.message_received" },
  steps: [
    {
      id: "draft",
      type: "draft",
      role: "smart",
      instructions: "Reply with our current prices.",
      context: ["trigger.message"],
      output: "google-mail.create-draft",
    },
    { id: "approve", type: "approval", channel: "gmail_drafts" },
  ],
  autonomy: { rung: 3 },
};

test("a member lands on Reviews, edits a drafted reply and approves it, and it leaves the list", async ({
  page,
  orgs: { orgA },
  signInAs,
  nango,
}) => {
  const gmail = [googleScope("gmail.modify")];
  // The admin publishes the workflow, which needs a Gmail connection of their own.
  await seedGoogleConnection({
    orgId: orgA.id,
    ownerUserId: orgA.admin.id,
    accountEmail: orgA.admin.email,
    scopes: gmail,
  });
  const { id: workflowId } = await saveWorkflow(orgA.admin.ctx, {
    name: "Pricing replies",
    spec: REPLY_SPEC,
  });
  const version = await publishWorkflow(orgA.admin.ctx, workflowId);
  // The member's own Gmail, with a question and the reply a run of it drafted, waiting.
  const nangoConnectionId = await nango.connect(orgA.member.email);
  const message = await nango.receive(nangoConnectionId, {
    from: "Ada Lovelace <ada@customer.test>",
    subject: "Quote for 30 oak chairs",
    text: QUESTION,
  });
  const draft = await nango.draft(nangoConnectionId, {
    threadId: message.threadId,
    to: "Ada Lovelace <ada@customer.test>",
    subject: "Re: Quote for 30 oak chairs",
    text: REPLY,
  });
  const { id: connectionId } = await seedGoogleConnection({
    orgId: orgA.id,
    ownerUserId: orgA.member.id,
    accountEmail: orgA.member.email,
    scopes: gmail,
    nangoConnectionId,
  });
  await createReview(systemCtx(orgA.id), {
    runId: randomUUID(),
    connectionId,
    workflowId,
    workflowVersionId: version.id,
    kind: "approval",
    itemRef: draft.id,
    threadRef: message.threadId,
    sourceRef: message.id,
  });
  await signInAs(orgA.member);

  await page.goto("/");
  await expect(page).toHaveURL("/reviews");
  await page.getByRole("link", { name: "Pricing replies" }).click();
  await expect(page.getByText(QUESTION)).toBeVisible();
  await expect(page.getByText(REPLY)).toBeVisible();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("textbox", { name: "Your reply" }).fill(EDITED);
  await page.getByRole("button", { name: "Send edited reply" }).click();

  await expect(page).toHaveURL("/reviews");
  await expect(page.getByText("Nothing is waiting for you.")).toBeVisible();
  const mailbox = await nango.mailbox(nangoConnectionId);
  expect(mailbox.drafts).toEqual([]);
  expect(mailbox.sent).toMatchObject([{ threadId: message.threadId, text: EDITED }]);
});
