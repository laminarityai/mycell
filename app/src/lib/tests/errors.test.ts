import { describe, expect, it } from "vitest";
import {
  actionError,
  ConflictError,
  InvariantError,
  NangoRequestError,
  NotFoundError,
  routeError,
  SendUnconfirmedError,
  typedErrorMessage,
} from "../errors";

describe("actionError and routeError", () => {
  it("turn a typed error into its message", async () => {
    expect(actionError(new ConflictError("Already published."))).toEqual({
      error: "Already published.",
    });
    const response = routeError(new NotFoundError("workflow"));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("That workflow doesn't exist.");
  });

  it("rethrow a can't-happen state as the bug it is, never showing its message", () => {
    const bug = new InvariantError("The review wasn't stored.");

    expect(() => actionError(bug)).toThrow(bug);
    expect(() => routeError(bug)).toThrow(bug);
    expect(typedErrorMessage(bug)).toBeUndefined();
  });

  it("rethrow the errors no user can act on: Nango failing, and a send its app didn't confirm", () => {
    for (const error of [
      new NangoRequestError("connect session", 503),
      new NangoRequestError("connection delete"),
      new SendUnconfirmedError(),
    ]) {
      expect(() => actionError(error)).toThrow(error);
      expect(() => routeError(error)).toThrow(error);
      expect(typedErrorMessage(error)).toBeUndefined();
    }
  });
});

describe("NangoRequestError", () => {
  it("names the call and Nango's status, or that Nango didn't answer", () => {
    expect(new NangoRequestError("connect session", 500).message).toBe(
      "Nango connect session failed: 500",
    );
    expect(new NangoRequestError("connection read").message).toBe(
      "Nango connection read failed: no answer",
    );
  });
});
