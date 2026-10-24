// A range's spending falls on UTC days whatever the database's own time zone: Postgres's
// `now()` and its day of a time follow the session's zone, which may not be UTC.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDatabaseTimeZone, setDatabaseTimeZone } from "@/db/testing/database-time-zone";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx } from "@/lib/ctx";
import { getLedgerStart, getSpendingSummary, grantCredits, listLedger } from "../server";
import { DAY_MS } from "../types";
import { spend } from "./spend";

beforeEach(resetDatabase);
afterAll(resetDatabaseTimeZone);

const startOfDay = (at: Date) =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

// Behind UTC and far ahead of it: one of them is on another day than UTC at most hours.
describe.each(["America/Los_Angeles", "Pacific/Kiritimati"])("on a database in %s", (zone) => {
  it("puts today's spending on today's UTC day, and its range on UTC days", async () => {
    await setDatabaseTimeZone(zone);
    const { orgA } = await seedTwoOrgs();
    const ctx = systemCtx(orgA.id);
    await grantCredits(ctx, 100, "Trial");
    await spend(ctx, 7, { workflowId: "wf_1", runId: "run_1" });
    const today = startOfDay(new Date());

    const week = await getSpendingSummary(orgA.admin.ctx, {
      from: new Date(today.getTime() - 3 * DAY_MS),
      to: new Date(today.getTime() + 4 * DAY_MS),
    });

    expect(week.days.map((day) => day.spent)).toEqual([0, 0, 0, 7, 0, 0, 0]);
    expect(week.byWorkflow[0]?.daily).toEqual([0, 0, 0, 7, 0, 0, 0]);
    const yesterday = { from: new Date(today.getTime() - DAY_MS), to: today };
    expect(await listLedger(orgA.admin.ctx, { range: yesterday })).toEqual([]);
    expect(startOfDay((await getLedgerStart(orgA.admin.ctx)) ?? new Date(0))).toEqual(today);
  });
});
