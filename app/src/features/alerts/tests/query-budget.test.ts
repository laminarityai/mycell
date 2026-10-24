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

beforeEach(resetDatabase);

/**
 * An admin out of credits, with `count` shared inboxes needing reconnecting and as many whose
 * backfill failed, beside a healthy one.
 */
async function adminWithBrokenInboxes(count: number): Promise<Ctx> {
  const { orgA } = await seedTwoOrgs();
  const admin = orgA.admin.ctx;
  await connectGoogle(admin, `fine@${orgA.workspaceDomain}`, { kind: "org" });
  for (let n = 0; n < count; n += 1) {
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
  it("makes the same queries for 3 alerts as for 21", async () => {
    const one = await adminWithBrokenInboxes(1);
    expect(await countAlerts(one)).toBe(3);
    const few = await countQueries(() => countAlerts(one));
    await resetDatabase();
    const ten = await adminWithBrokenInboxes(10);
    expect(await countAlerts(ten)).toBe(21);
    const many = await countQueries(() => countAlerts(ten));

    // The runway's two, the failed backfills and the connections that need fixing.
    expect(few.queries).toBe(4);
    expect(many.queries).toBe(few.queries);
  });
});
