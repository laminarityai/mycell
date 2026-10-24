// A backfill page fetches each message on it through the Nango proxy, so the page must read the
// connection once, not once per message: the same queries for 1 message as for 10. The sweep
// runs every minute, so it reads an org's connections and their apps' states in the same
// queries for 1 connection as for 5.
import { beforeEach, describe, expect, it } from "vitest";
import { countQueries } from "@/db/testing/count-queries";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import type { Ctx } from "@/lib/ctx";
import { connectMailbox, daysAgo } from "@/testing/connect-helpers";
import { backfillConnection, pollAllConnections } from "../server";

beforeEach(resetDatabase);

const messages = (to: string, count: number) =>
  Array.from({ length: count }, (_, n) => ({
    from: `buyer-${String(n)}@customer.example`,
    to: [to],
    subject: `Order ${String(n)}`,
    text: "Is this in stock?",
    at: daysAgo(1),
  }));

async function backfillQueries(ctx: Ctx, email: string, count: number): Promise<number> {
  const connection = await connectMailbox(ctx, email, messages(email, count));
  const counted = await countQueries(async () => {
    expect(await backfillConnection(ctx, connection.id)).toMatchObject({ items: count });
  });
  return counted.queries;
}

describe("a Gmail backfill's query budget", () => {
  it("makes the same queries for a page of 1 message as for 10", async () => {
    const { orgA } = await seedTwoOrgs();

    const one = await backfillQueries(orgA.member.ctx, orgA.member.email, 1);
    const ten = await backfillQueries(orgA.admin.ctx, orgA.admin.email, 10);

    expect(ten).toBe(one);
  });
});

describe("the sweep's query budget", () => {
  it("makes the same queries for 1 connection in an org as for 5", async () => {
    const { orgA } = await seedTwoOrgs();
    const own = await connectMailbox(orgA.member.ctx, orgA.member.email);
    await backfillConnection(orgA.member.ctx, own.id);
    const sweep = () => countQueries(async () => pollAllConnections());

    const one = await sweep();
    for (const n of [1, 2, 3, 4]) {
      const inbox = await connectMailbox(
        orgA.admin.ctx,
        `inbox-${String(n)}@${orgA.workspaceDomain}`,
        [],
        "org",
      );
      await backfillConnection(orgA.admin.ctx, inbox.id);
    }
    expect(await pollAllConnections()).toHaveLength(5);
    const five = await sweep();

    expect(five.queries).toBe(one.queries);
  });
});
