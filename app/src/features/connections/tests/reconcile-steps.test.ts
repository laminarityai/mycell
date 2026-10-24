// The nightly reconciliation's steps: one reading both sides, then one per connection it acts
// on, so a large org's run never makes one long step, and a retry after a crash goes on from
// the last finished connection.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import type { Ctx } from "@/lib/ctx";
import { connectGmail } from "@/testing/connect-helpers";
import { fakeNango } from "@/testing/fake-nango";
import { recordingStepRunner } from "@/testing/recording-step-runner";
import { disconnect, listConnections, reconcileConnections, startConnect } from "../server";

beforeEach(resetDatabase);

const HOUR_MS = 60 * 60 * 1000;
const dayAndAnHourLater = () => new Date(Date.now() + 25 * HOUR_MS);

// A connection Nango deleted with no webhook: Mycel's row stays.
async function goneAtNango(ctx: Ctx, emailAddress: string) {
  const { connectionId: nangoId } = await connectGmail(ctx, emailAddress);
  const connection = (await listConnections(ctx)).connections.at(0);
  fakeNango.deleteWithoutWebhook(nangoId);
  return connection?.id ?? "";
}

// A connection Mycel forgot while Nango's delete failed: Nango's stays.
async function orphanAtNango(ctx: Ctx, emailAddress: string) {
  const { connectionId: nangoId } = await connectGmail(ctx, emailAddress);
  const connection = (await listConnections(ctx)).connections.at(0);
  fakeNango.failDeletes();
  await disconnect(ctx, connection?.id ?? "");
  fakeNango.failDeletes(false);
  return nangoId;
}

async function bothSides() {
  const { orgA, orgB } = await seedTwoOrgs();
  const rows = [
    { orgId: orgA.id, connectionId: await goneAtNango(orgA.member.ctx, orgA.member.email) },
    { orgId: orgB.id, connectionId: await goneAtNango(orgB.member.ctx, orgB.member.email) },
  ];
  const orphan = await orphanAtNango(orgA.admin.ctx, orgA.admin.email);
  return { orgA, rows, orphan };
}

describe("reconcileConnections' steps", () => {
  it("reads both sides in one step, then takes one step per connection it acts on", async () => {
    const { rows, orphan } = await bothSides();
    const runner = recordingStepRunner();

    const summary = await reconcileConnections(undefined, runner.runStep);

    expect(summary.deletedRows).toEqual(expect.arrayContaining(rows));
    expect(summary.deletedRows).toHaveLength(2);
    expect(summary.deletedAtNango).toEqual([{ nangoConnectionId: orphan, integration: "google" }]);
    expect(runner.ids[0]).toBe("read");
    expect(runner.ids.slice(1).sort()).toEqual(
      [
        ...rows.map((row) => `confirm-${row.connectionId}`),
        `delete-at-nango-google-${orphan}`,
      ].sort(),
    );
  });

  it("goes on after a crash from the last finished connection, reading neither side again", async () => {
    const { orgA, rows, orphan } = await bothSides();
    const runner = recordingStepRunner();
    runner.crashAt(`delete-at-nango-google-${orphan}`);

    await expect(reconcileConnections(dayAndAnHourLater(), runner.runStep)).rejects.toThrow();
    expect(fakeNango.hasConnection(orphan)).toBe(true);
    // An orphan Nango lists only now: a run that read Nango again would delete it too.
    const { token } = await startConnect(orgA.member.ctx, "google");
    const late = fakeNango.completeConnect(token, { emailAddress: orgA.member.email });

    const summary = await reconcileConnections(dayAndAnHourLater(), runner.runStep);

    expect(summary.deletedRows).toEqual(expect.arrayContaining(rows));
    expect(summary.deletedAtNango).toEqual([{ nangoConnectionId: orphan, integration: "google" }]);
    expect(fakeNango.hasConnection(orphan)).toBe(false);
    expect(fakeNango.hasConnection(late.connectionId)).toBe(true);
  });
});
