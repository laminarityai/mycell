// The e2e `test`: each test that asks for `orgs` starts from an empty database seeded with the
// shared two-org fixture, and `signInAs` signs the test's browser in as one of its users.
import { test as base, type Page } from "@playwright/test";
import { closeDb } from "@/db/client";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs, type FixtureUser, type TwoOrgs } from "@/db/testing/two-org-fixture";
import { signInAs } from "./sign-in-as";

type TestFixtures = {
  orgs: TwoOrgs;
  signInAs: (user: FixtureUser) => Promise<void>;
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
  orgs: async ({}, provide) => {
    await resetDatabase();
    await provide(await seedTwoOrgs());
  },
  signInAs: async ({ context }, provide) => {
    await provide((user) => signInAs(context, user.id));
  },
});

export { expect } from "@playwright/test";

/** The org page's row for a user, found by their email. */
export function userRow(page: Page, user: FixtureUser) {
  return page.getByRole("row").filter({ hasText: user.email });
}
