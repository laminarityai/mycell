import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDatabaseTimeZone, setDatabaseTimeZone } from "@/db/testing/database-time-zone";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { connectGmail } from "@/testing/connect-helpers";
import { listConnections, startConnect } from "../server";

// A database outside UTC, like the local Postgres in America/Los_Angeles.
beforeAll(() => setDatabaseTimeZone("America/Los_Angeles"));
afterAll(resetDatabaseTimeZone);
beforeEach(resetDatabase);

/** Expects `time` within a minute of now: a time zone mix-up shifts it by whole hours. */
function expectNow(time: Date | undefined) {
  expect(time).toBeInstanceOf(Date);
  expect(Math.abs((time as Date).getTime() - Date.now())).toBeLessThan(60_000);
}

describe("connection times on a database outside UTC", () => {
  it("read back as the moment they were recorded", async () => {
    const { orgA } = await seedTwoOrgs();

    await startConnect(orgA.admin.ctx, "google");
    await connectGmail(orgA.member.ctx, orgA.member.email);

    expectNow((await listConnections(orgA.admin.ctx)).attempts.at(0)?.createdAt);
    expectNow((await listConnections(orgA.member.ctx)).connections.at(0)?.createdAt);
  });
});
