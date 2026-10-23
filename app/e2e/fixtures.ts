// The e2e `test`: each test that asks for `orgs` starts from an empty database seeded with the
// shared two-org fixture, each org granted `credits` (funded by default, since a zero balance
// pauses every workflow; a test that wants none says `test.use({ credits: 0 })`), and
// `signInAs` signs the test's browser in as one of its users.
import { test as base, expect, type Page } from "@playwright/test";
import { closeDb } from "@/db/client";
import { resetDatabase } from "@/db/testing/reset";
import {
  FUNDED_CREDITS,
  seedTwoOrgs,
  type FixtureUser,
  type TwoOrgs,
} from "@/db/testing/two-org-fixture";
import { fakeAiGateway, type E2eAiGateway } from "./fake-ai-gateway";
import { fakeNango, type E2eNango } from "./fake-nango";
import { signInAs } from "./sign-in-as";

type TestFixtures = {
  /** The credits each org is granted before the test. */
  credits: number;
  orgs: TwoOrgs;
  signInAs: (user: FixtureUser) => Promise<void>;
  /** The fake AI Gateway, emptied for the test; a test that leaves a request unscripted fails. */
  aiGateway: E2eAiGateway;
  /** The fake Nango, emptied for the test; a request it can't answer fails the test. */
  nango: E2eNango;
};
type WorkerFixtures = { database: undefined };

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // Closes the worker's database pool once its tests are done.
  database: [
    async ({}, provide) => {
      await provide(undefined);
      await closeDb();
    },
    { scope: "worker", auto: true },
  ],
  credits: [FUNDED_CREDITS, { option: true }],
  orgs: async ({ credits }, provide) => {
    await resetDatabase();
    await provide(await seedTwoOrgs({ credits }));
  },
  signInAs: async ({ context }, provide) => {
    await provide((user) => signInAs(context, user.id));
  },
  aiGateway: async ({ request }, provide) => {
    const gateway = await fakeAiGateway(request);
    await provide(gateway);
    expect(await gateway.unscripted(), "model calls the test didn't script").toEqual([]);
  },
  nango: async ({ request }, provide) => {
    const nango = await fakeNango(request);
    await provide(nango);
    expect(await nango.unhandled(), "Nango requests the fake couldn't answer").toEqual([]);
  },
});

export { expect } from "@playwright/test";

/** The org page's row for a user, found by their email. */
export function userRow(page: Page, user: FixtureUser) {
  return page.getByRole("row").filter({ hasText: user.email });
}
