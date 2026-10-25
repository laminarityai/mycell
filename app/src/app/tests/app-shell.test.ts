// The app shell's sidebar: which items each person sees, and what its counts and foot read for
// the signed-in person on every page load.
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedGoogleConnection } from "@/db/testing/seed-connection";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits, recordUsage } from "@/features/credits/server";
import { createReview } from "@/features/reviews/server";
import { systemCtx } from "@/lib/ctx";
import { googleScope } from "@/lib/google";
import { navGroupsFor } from "../_shell/nav-model";
import { loadShell } from "../_shell/shell-data";

beforeEach(resetDatabase);

const labelsOf = (admin: boolean) =>
  navGroupsFor(admin).map((group) => [group.label, group.items.map((item) => item.label)]);

describe("the sidebar's items", () => {
  it("groups an admin's items under Your work, Company, and Accounts and memory", () => {
    expect(labelsOf(true)).toEqual([
      ["Your work", ["Reviews", "Workflows", "Runs", "Ask Mycel"]],
      [
        "Company",
        [
          "Alerts",
          "Builder chat",
          "Credits",
          "Custom actions",
          "Capability requests",
          "Manage tags",
        ],
      ],
      ["Accounts and memory", ["Connections", "Your org", "Memory log", "Memory settings"]],
    ]);
  });

  it("never shows a member the Company group or memory's settings", () => {
    expect(labelsOf(false)).toEqual([
      ["Your work", ["Reviews", "Workflows", "Runs", "Ask Mycel"]],
      ["Accounts and memory", ["Connections", "Your org", "Memory log"]],
    ]);
  });
});

describe("what the shell reads for the signed-in person", () => {
  it("counts the reviews waiting for them and names them, their role and their org", async () => {
    const { orgA } = await seedTwoOrgs();
    const { id: connectionId } = await seedGoogleConnection({
      orgId: orgA.id,
      ownerUserId: orgA.member.id,
      accountEmail: orgA.member.email,
      scopes: [googleScope("gmail.modify")],
    });
    for (const n of [1, 2]) {
      await createReview(systemCtx(orgA.id), {
        runId: randomUUID(),
        connectionId,
        workflowId: randomUUID(),
        workflowVersionId: randomUUID(),
        kind: "approval",
        itemRef: `draft-${String(n)}`,
        threadRef: `thread-${String(n)}`,
        sourceRef: `message-${String(n)}`,
      });
    }

    expect(await loadShell(orgA.member.ctx)).toEqual({
      admin: false,
      viewer: { name: orgA.member.email, role: "member" },
      orgName: "Org A",
      counts: { reviews: 2 },
    });
    // The member's reviews aren't the admin's, and only the admin sees the company's credits
    // and alerts: with none granted, credits are out.
    expect(await loadShell(orgA.admin.ctx)).toEqual({
      admin: true,
      viewer: { name: orgA.admin.email, role: "admin" },
      orgName: "Org A",
      counts: { reviews: 0, alerts: 1 },
      credits: { balance: 0, runwayDays: null },
    });
  });

  it("gives an admin the balance and how many days it lasts at this week's rate", async () => {
    const { orgA } = await seedTwoOrgs();
    await grantCredits(systemCtx(orgA.id), 1000, "October allowance");
    await recordUsage(systemCtx(orgA.id), {
      role: "fast",
      modelId: "openai/x",
      costUsd: 0.07,
      outcome: "succeeded",
      purpose: "builder",
    });

    const { credits } = await loadShell(orgA.admin.ctx);

    expect(credits?.balance).toBeCloseTo(930);
    expect(credits?.runwayDays).toBeCloseTo(93);
    expect((await loadShell(orgA.member.ctx)).credits).toBeUndefined();
  });
});
