import { randomUUID } from "node:crypto";
import { seedGoogleConnection } from "@/db/testing/seed-connection";
import { createReview } from "@/features/reviews/server";
import { systemCtx } from "@/lib/ctx";
import { googleScope } from "@/lib/google";
import { expect, test } from "./fixtures";

test("every page's navigation counts the member's waiting reviews", async ({
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
});
