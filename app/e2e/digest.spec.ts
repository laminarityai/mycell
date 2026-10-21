import { randomUUID } from "node:crypto";
import { seedGoogleConnection } from "@/db/testing/seed-connection";
import { reviewDigestOn, unsubscribeLink } from "@/features/notifications/server";
import { createReview } from "@/features/reviews/server";
import { systemCtx } from "@/lib/ctx";
import { googleScope } from "@/lib/google";
import { expect, test } from "./fixtures";

test("the navigation counts the member's waiting reviews, and they can turn the daily email off", async ({
  page,
  orgs: { orgA },
  signInAs,
}) => {
  // A review waiting on the member's own Gmail. Listing it reads nothing from Gmail.
  const { id: connectionId } = await seedGoogleConnection({
    orgId: orgA.id,
    ownerUserId: orgA.member.id,
    accountEmail: orgA.member.email,
    scopes: [googleScope("gmail.modify")],
  });
  await createReview(systemCtx(orgA.id), {
    runId: randomUUID(),
    connectionId,
    workflowId: randomUUID(),
    workflowVersionId: randomUUID(),
    kind: "approval",
    itemRef: "draft-1",
    threadRef: "thread-1",
    sourceRef: "message-1",
  });
  await signInAs(orgA.member);

  await page.goto("/org");
  await expect(page.getByRole("link", { name: "Reviews 1 waiting" })).toBeVisible();
  await page.goto("/workflows");
  await expect(page.getByRole("link", { name: "Reviews 1 waiting" })).toBeVisible();

  await page.goto("/reviews");
  const digest = page.getByRole("switch", { name: "Email me each day when reviews are waiting" });
  await expect(digest).toBeChecked();
  await digest.click();
  await expect(digest).not.toBeChecked();
  await page.reload();
  await expect(digest).not.toBeChecked();
  expect(await reviewDigestOn(orgA.member.ctx)).toBe(false);
});

test("the digest's unsubscribe link turns the daily email off without signing in", async ({
  page,
  orgs: { orgA },
}) => {
  await page.goto(unsubscribeLink(systemCtx(orgA.id), orgA.member.id));
  await page.getByRole("button", { name: "Turn off the daily email" }).click();

  await expect(page.getByText("The daily review email is off.")).toBeVisible();
  expect(await reviewDigestOn(orgA.member.ctx)).toBe(false);
  expect(await reviewDigestOn(orgA.admin.ctx)).toBe(true);
});

test("an unsubscribe link Mycel didn't sign turns nothing off", async ({
  page,
  orgs: { orgA },
}) => {
  await page.goto("/unsubscribe?token=forged.token");
  await page.getByRole("button", { name: "Turn off the daily email" }).click();

  await expect(page.getByRole("alert")).toHaveText("This unsubscribe link isn't valid.");
  expect(await reviewDigestOn(orgA.member.ctx)).toBe(true);
});
