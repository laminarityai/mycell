// Vitest setup file: every test reaches the fake Nango instead of the network. A request to
// anything the fake doesn't handle fails the test.
import { setupServer } from "msw/node";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { fakeNango } from "./fake-nango";

const server = setupServer(...fakeNango.handlers);

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
beforeEach(() => {
  fakeNango.reset();
});
afterAll(() => {
  server.close();
});
