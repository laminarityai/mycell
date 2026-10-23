// The environment's checks: away from the local Inngest dev server (production, CI's build and
// the e2e tests), what production needs is required at boot, not found missing at run time.
import { describe, expect, it } from "vitest";
import { parseEnv } from "@/env";

const base = {
  DATABASE_URL: "postgres://mycel:mycel@localhost:5433/mycel",
  BETTER_AUTH_SECRET: "a-secret-that-is-at-least-32-characters",
  BETTER_AUTH_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
  NANGO_API_KEY: "key",
  NANGO_WEBHOOK_SIGNING_KEY: "signing-key",
  AI_GATEWAY_API_KEY: "key",
  MODEL_CLASSIFY: "typesafe-ai/jev-1.14.0",
  MODEL_FAST: "test/fast",
  MODEL_SMART: "test/smart",
  MODEL_JUDGE: "test/judge",
};
const cloud = {
  ...base,
  INNGEST_EVENT_KEY: "event-key",
  INNGEST_SIGNING_KEY: "signkey-test-00000000000000000000000000000000",
  INNGEST_ENCRYPTION_KEY: "an-encryption-key-of-32-chars-at-least",
};

const push = {
  GMAIL_PUSH_TOPIC: "projects/mycel/topics/gmail-push",
  GOOGLE_PUSH_AUDIENCE: "https://mycel.example/api/google/gmail-push",
  GOOGLE_PUSH_SERVICE_ACCOUNT: "gmail-push-sender@mycel.iam.gserviceaccount.com",
};

describe("the environment", () => {
  it("needs KMS_REGION unless INNGEST_DEV=1, since every held send needs the key store", () => {
    expect(() => parseEnv(cloud)).toThrow(/KMS_REGION/);
    expect(parseEnv({ ...cloud, KMS_REGION: "eu-west-2" }).KMS_REGION).toBe("eu-west-2");
    expect(parseEnv({ ...base, INNGEST_DEV: "1" }).KMS_REGION).toBeUndefined();
  });

  it("needs Inngest Cloud's keys unless INNGEST_DEV=1", () => {
    expect(() => parseEnv({ ...base, KMS_REGION: "eu-west-2" })).toThrow(/INNGEST_EVENT_KEY/);
  });

  it("takes Gmail push's three settings all together or not at all", () => {
    const local = { ...base, INNGEST_DEV: "1" };
    expect(parseEnv(local).GMAIL_PUSH_TOPIC).toBeUndefined();
    expect(parseEnv({ ...local, ...push })).toMatchObject(push);
    for (const left of Object.keys(push)) {
      const some = Object.fromEntries(Object.entries(push).filter(([key]) => key !== left));
      expect(() => parseEnv({ ...local, ...some })).toThrow(new RegExp(left));
    }
    expect(() => parseEnv({ ...local, GMAIL_PUSH_TOPIC: push.GMAIL_PUSH_TOPIC })).toThrow(
      /GOOGLE_PUSH_AUDIENCE/,
    );
  });

  it("takes Gmail's topic only as its full resource name", () => {
    const local = { ...base, INNGEST_DEV: "1", ...push, GMAIL_PUSH_TOPIC: "gmail-push" };
    expect(() => parseEnv(local)).toThrow(/GMAIL_PUSH_TOPIC/);
  });
});
