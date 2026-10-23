// The custom actions page lists every capability request with how often it was asked, so the
// list must make the same queries, and read the same rows, for 1 request as for 10, however
// many times each was asked: counted in the database, never by loading every ask.
import { beforeEach, describe, expect, it } from "vitest";
import { countQueries } from "@/db/testing/count-queries";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { fileCapabilityRequest, listCapabilityRequests } from "../server";
import { fileRequest, MERGE_CONTACTS } from "./capability-request-helpers";

beforeEach(resetDatabase);

describe("the capability request list's query budget", () => {
  it("makes the same queries for 1 request as for 10, and reads no row per ask", async () => {
    const { orgA } = await seedTwoOrgs();
    const admin = orgA.admin.ctx;
    const ask = (n: number) => ({ ...MERGE_CONTACTS, operation: `Operation ${String(n)}` });
    const first = await fileRequest(admin, ask(1));

    const one = await countQueries(() => listCapabilityRequests(admin));
    // Asked again in the same conversation: one more ask, no more conversations.
    for (let n = 0; n < 5; n += 1) {
      await fileCapabilityRequest(admin, ask(1), { conversationId: first.conversationId });
    }
    const asked = await countQueries(() => listCapabilityRequests(admin));
    for (let n = 2; n <= 10; n += 1) await fileRequest(admin, ask(n));
    const ten = await countQueries(() => listCapabilityRequests(admin));

    expect(asked).toEqual(one);
    expect(ten.queries).toBe(one.queries);
    const listed = await listCapabilityRequests(admin);
    expect(listed).toHaveLength(10);
    expect(listed.find((request) => request.operation === "Operation 1")).toEqual(
      expect.objectContaining({ count: 6, conversationIds: [first.conversationId] }),
    );
  });
});
