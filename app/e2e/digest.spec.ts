import { randomUUID } from "node:crypto";
import { seedGoogleConnection } from "@/db/testing/seed-connection";
import { reviewDigestOn, unsubscribeLink } from "@/features/notifications/server";
import { createReview } from "@/features/reviews/server";
import { systemCtx } from "@/lib/ctx";
import { googleScope } from "@/lib/google";
import { expect, test } from "./fixtures";

test("every page's navigation counts the member's waiting reviews, and they can turn the daily email off", async ({
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
  const waitingOn = (n: number) =>
    createReview(systemCtx(orgA.id), {
      runId: randomUUID(),
      connectionId,
      workflowId: randomUUID(),
      workflowVersionId: randomUUID(),
      kind: "approval",
      itemRef: `draft-${String(n)}`,
      threadRef: `thread-${String(n)}`,
      sourceRef: `message-${String(n)}`,
    });
  await waitingOn(1);
  await signInAs(orgA.member);
  const nav = page.getByRole("navigation", { name: "Main" });

  await page.goto("/org");
  await expect(nav.getByRole("link", { name: "Reviews 1 waiting" })).toBeVisible();
  // Every page's navigation reads the count again, following its links too.
  await waitingOn(2);
  for (const [link, heading] of [
    ["Workflows", "Workflows"],
    ["Connections", "Connections"],
    ["Your org", "Your org"],
  ] as const) {
    await nav.getByRole("link", { name: link }).click();
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Reviews 2 waiting" })).toBeVisible();
  }

  await nav.getByRole("link", { name: "Reviews 2 waiting" }).click();
  await expect(page.getByRole("heading", { name: "Reviews", level: 1 })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Reviews 2 waiting" })).toBeVisible();
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

  await expect(page.getByText("This unsubscribe link isn't valid.")).toBeVisible();
  expect(await reviewDigestOn(orgA.member.ctx)).toBe(true);
});
