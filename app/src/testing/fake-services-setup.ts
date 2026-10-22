// Vitest setup file: every test reaches the fake Nango, the fake Inngest, the fake AI Gateway,
// the fake Model Armor and the fake KMS instead of the network. A request to anything the fakes
// don't handle fails the test.
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, expect } from "vitest";
import { fakeAiGateway } from "./fake-ai-gateway";
import { fakeInngest } from "./fake-inngest";
import { fakeKms } from "./fake-kms";
import { fakeModelArmor } from "./fake-model-armor";
import { fakeNango } from "./fake-nango";

const server = setupServer(
  ...fakeNango.handlers,
  ...fakeInngest.handlers,
  ...fakeAiGateway.handlers,
  ...fakeModelArmor.handlers,
  ...fakeKms.handlers,
);

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
beforeEach(() => {
  fakeNango.reset();
  fakeInngest.reset();
  fakeAiGateway.reset();
  fakeModelArmor.reset();
  fakeKms.reset();
});
afterEach(() => {
  expect(fakeAiGateway.unscripted(), "model calls the test didn't script").toEqual([]);
});
afterAll(() => {
  server.close();
});
