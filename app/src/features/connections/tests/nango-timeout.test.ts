// A request to Nango that gets no whole answer within a minute fails as Nango not answering
// (NangoRequestError), so a hung connection ends a job's step instead of holding it open.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { NangoRequestError } from "@/lib/errors";
import { connectGmail } from "@/testing/connect-helpers";
import { fakeNango } from "@/testing/fake-nango";
import { disconnect, listConnections, reconcileConnections } from "../server";

beforeEach(resetDatabase);
afterEach(() => {
  vi.useRealTimers();
});

const SECOND_MS = 1000;

describe("a request to Nango that never answers", () => {
  it("fails with NangoRequestError after a minute, not before", async () => {
    await seedTwoOrgs();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const arrived = fakeNango.hang();
    let settled = false;
    const run = reconcileConnections().finally(() => {
      settled = true;
    });
    const failed = run.catch((error: unknown) => error);
    await arrived;

    await vi.advanceTimersByTimeAsync(59 * SECOND_MS);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(SECOND_MS);

    const error = await failed;
    expect(error).toBeInstanceOf(NangoRequestError);
    expect(error).toMatchObject({ message: "Nango connection list failed: no answer" });
  });

  it("is handled as Nango being unreachable: a disconnect still forgets the connection", async () => {
    const { orgA } = await seedTwoOrgs();
    const { connectionId: nangoId } = await connectGmail(orgA.member.ctx, orgA.member.email);
    const [connection] = (await listConnections(orgA.member.ctx)).connections;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const arrived = fakeNango.hang();
    const disconnecting = disconnect(orgA.member.ctx, connection.id);
    await arrived;

    await vi.advanceTimersByTimeAsync(60 * SECOND_MS);
    await disconnecting;

    vi.useRealTimers();
    expect((await listConnections(orgA.member.ctx)).connections).toEqual([]);
    // Left for reconciliation to delete.
    expect(fakeNango.hasConnection(nangoId)).toBe(true);
  });
});
