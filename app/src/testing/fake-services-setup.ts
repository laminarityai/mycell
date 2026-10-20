// Vitest setup file: every test reaches the fake Nango and the fake Inngest instead of the
// network. A request to anything the fakes don't handle fails the test.
import { setupServer } from "msw/node";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { fakeInngest } from "./fake-inngest";
import { fakeNango } from "./fake-nango";

const server = setupServer(...fakeNango.handlers, ...fakeInngest.handlers);

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
beforeEach(() => {
  fakeNango.reset();
  fakeInngest.reset();
});
afterAll(() => {
  server.close();
});
