// The app shell counts an admin's alerts on every page, so counting them must cost the same
// however many there are.
import { beforeEach, describe, expect, it } from "vitest";
import { countQueries } from "@/db/testing/count-queries";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { recordIngestState } from "@/features/connections/server";
import { type Ctx, systemCtx } from "@/lib/ctx";
import { connectGoogle, deliver } from "@/testing/connect-helpers";
import { fakeNango } from "@/testing/fake-nango";
import { countAlerts } from "../server";
import { pauseFailing, publishLabels, spendOn } from "@/testing/paused-workflow-helpers";

beforeEach(resetDatabase);

/**
 * An admin out of credits, with `count` shared inboxes needing reconnecting and as many whose
 * backfill failed, beside a healthy one, and as many workflows paused for failing and at their
 * budget, beside a workflow under its budget.
 */
async function adminWithBrokenInboxes(count: number): Promise<Ctx> {
  const { orgA } = await seedTwoOrgs();
  const admin = orgA.admin.ctx;
  await connectGoogle(admin, `fine@${orgA.workspaceDomain}`, { kind: "org" });
  await connectGoogle(admin, orgA.admin.email);
  await publishLabels(admin, "Untroubled", 100);
  for (let n = 0; n < count; n += 1) {
    await pauseFailing(orgA.id, await publishLabels(admin, `Failing ${String(n)}`));
    await spendOn(orgA.id, await publishLabels(admin, `Spent ${String(n)}`, 1), 1);
    const locked = await connectGoogle(admin, `locked-${String(n)}@${orgA.workspaceDomain}`, {
      kind: "org",
    });
    await deliver(fakeNango.authWebhook(locked.nangoConnectionId, "refresh", false));
    const unread = await connectGoogle(admin, `unread-${String(n)}@${orgA.workspaceDomain}`, {
      kind: "org",
    });
    await recordIngestState(systemCtx(orgA.id), unread.id, "gmail", { status: "failed" });
  }
  return admin;
}

describe("countAlerts' query budget", () => {
  it("makes the same queries for 5 alerts as for 41", async () => {
    const one = await adminWithBrokenInboxes(1);
    expect(await countAlerts(one)).toBe(5);
    const few = await countQueries(() => countAlerts(one));
    await resetDatabase();
    const ten = await adminWithBrokenInboxes(10);
    expect(await countAlerts(ten)).toBe(41);
    const many = await countQueries(() => countAlerts(ten));

    // The runway's two, the failed backfills and the connections that need fixing, then the
    // workflows, their latest versions and the budgeted ones' spending this month by day.
    expect(few.queries).toBe(7);
    expect(many.queries).toBe(few.queries);
  });
});
