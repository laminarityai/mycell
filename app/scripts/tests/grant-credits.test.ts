import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { getBalance, listLedger } from "@/features/credits/server";
import { fakeInngest } from "@/testing/fake-inngest";
import { runGrantCreditsCommand, USAGE } from "../grant-credits-command";

beforeEach(resetDatabase);

describe("pnpm credits:grant", () => {
  it("grants the credits with their note, and says credits were granted", async () => {
    const { orgA, orgB } = await seedTwoOrgs();

    const { exitCode, output } = await runGrantCreditsCommand([
      orgA.id,
      "500",
      "October",
      "allowance",
    ]);

    expect(exitCode).toBe(0);
    expect(output).toBe(`Granted 500 credits (October allowance). Org ${orgA.id} now has 500.`);
    expect(await listLedger(orgA.admin.ctx)).toMatchObject([
      { kind: "grant", amount: 500, note: "October allowance" },
    ]);
    expect(await getBalance(orgB.admin.ctx)).toBe(0);
    expect(fakeInngest.sent("credits/granted").map((event) => event.data)).toEqual([
      { orgId: orgA.id },
    ]);
  });

  it("refuses a grant without a note, and grants nothing", async () => {
    const { orgA } = await seedTwoOrgs();

    for (const args of [[orgA.id, "500"], [orgA.id, "500", " "], [orgA.id], []]) {
      expect(await runGrantCreditsCommand(args)).toEqual({ exitCode: 1, output: USAGE });
    }

    expect(await getBalance(orgA.admin.ctx)).toBe(0);
    expect(fakeInngest.sent("credits/granted")).toEqual([]);
  });

  it("refuses an org that doesn't exist, or credits that aren't a positive number", async () => {
    const { orgA } = await seedTwoOrgs();

    expect(await runGrantCreditsCommand(["org_nope", "500", "Trial"])).toEqual({
      exitCode: 1,
      output: "No org has the ID org_nope.",
    });
    expect(await runGrantCreditsCommand([orgA.id, "-5", "Trial"])).toEqual({
      exitCode: 1,
      output: USAGE,
    });
    expect(await getBalance(orgA.admin.ctx)).toBe(0);
  });
});
