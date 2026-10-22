// A source client checks the caller's access to a connection once, so a job step making many
// proxied calls (a page of a Gmail backfill) reads the connection once rather than per call.
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { countQueries } from "@/db/testing/count-queries";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { systemCtx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { connectMailbox } from "@/testing/connect-helpers";
import { disconnect, sourceClient } from "../server";

beforeEach(resetDatabase);

const profile = z.object({ emailAddress: z.string() });
const PROFILE = "/gmail/v1/users/me/profile";

describe("sourceClient", () => {
  it("reads the connection once, however many calls it makes", async () => {
    const { orgA } = await seedTwoOrgs();
    const own = await connectMailbox(orgA.member.ctx, orgA.member.email);

    let client: Awaited<ReturnType<typeof sourceClient>> | undefined;
    const opened = await countQueries(async () => {
      client = await sourceClient(orgA.member.ctx, own.id);
    });
    const calls = await countQueries(async () => {
      for (let n = 0; n < 5; n += 1) await client?.get(PROFILE, profile);
    });

    expect(opened).toEqual({ queries: 1, rows: 1 });
    expect(calls.queries).toBe(0);
    expect(client?.connection).toMatchObject({ id: own.id, kind: "member" });
    expect(await client?.get(PROFILE, profile)).toEqual({ emailAddress: orgA.member.email });
  });

  it("allows whom each proxy call allows: the owner and the system ctx, not another member", async () => {
    const { orgA } = await seedTwoOrgs();
    const own = await connectMailbox(orgA.member.ctx, orgA.member.email);

    await expect(sourceClient(orgA.admin.ctx, own.id)).rejects.toThrow(ForbiddenError);
    const system = await sourceClient(systemCtx(orgA.id), own.id);
    expect(await system.get(PROFILE, profile)).toEqual({ emailAddress: orgA.member.email });
  });

  it("turns a connection deleted after it was opened into not found on the next call", async () => {
    const { orgA } = await seedTwoOrgs();
    const own = await connectMailbox(orgA.member.ctx, orgA.member.email);
    const client = await sourceClient(orgA.member.ctx, own.id);

    await disconnect(orgA.member.ctx, own.id);

    await expect(client.get(PROFILE, profile)).rejects.toThrow(NotFoundError);
    await expect(sourceClient(orgA.member.ctx, own.id)).rejects.toThrow(NotFoundError);
  });
});
