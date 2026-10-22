// The registered apps' configuration (ADR-0018): what our team writes when registering an app.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isAppHost, REGISTERED_APPS, registeredApps } from "../registered-apps";

// Vitest runs from `app/`, which the descriptions' paths are relative to.
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("the registered apps", () => {
  it("are Google and Pipedrive, each on its own Nango integration", () => {
    expect(registeredApps.map((app) => [app.id, app.integration])).toEqual([
      ["google", "google"],
      ["pipedrive", "pipedrive"],
    ]);
  });

  it("include no accounting or payments app, and none whose terms ban stored indexes", () => {
    expect(registeredApps.filter((app) => app.accountingOrPayments)).toEqual([]);
    expect(registeredApps.filter((app) => app.bansStoredIndexes)).toEqual([]);
  });

  it("keep each Google API description, served from one of Google's hosts", () => {
    const google = REGISTERED_APPS.google;
    expect(google.apiDescription.format).toBe("google-discovery");
    for (const { path } of google.apiDescription.files) {
      const description = JSON.parse(read(path)) as { kind: string; rootUrl: string };
      expect(description.kind).toBe("discovery#restDescription");
      expect(isAppHost(google, description.rootUrl)).toBe(true);
    }
  });

  it("keep Pipedrive's OpenAPI descriptions", () => {
    const pipedrive = REGISTERED_APPS.pipedrive;
    expect(pipedrive.apiDescription.files.map(({ path }) => read(path).split("\n", 2))).toEqual([
      ["openapi: 3.0.1", "info:"],
      ["openapi: 3.0.1", "info:"],
    ]);
  });
});

describe("isAppHost", () => {
  it("accepts an app's own hosts, and a company's subdomain for a `*.` host", () => {
    expect(isAppHost(REGISTERED_APPS.google, "https://gmail.googleapis.com/gmail/v1/")).toBe(true);
    expect(isAppHost(REGISTERED_APPS.pipedrive, "https://acme.pipedrive.com/api/v1/deals")).toBe(
      true,
    );
  });

  it("refuses any other host, scheme or port", () => {
    const pipedrive = REGISTERED_APPS.pipedrive;
    for (const url of [
      "https://pipedrive.com/api",
      "https://acme.pipedrive.com.evil.example/api",
      "https://evilpipedrive.com/api",
      "http://acme.pipedrive.com/api",
      "https://acme.pipedrive.com:8443/api",
      "not a url",
    ]) {
      expect(isAppHost(pipedrive, url), url).toBe(false);
    }
    expect(isAppHost(REGISTERED_APPS.google, "https://acme.pipedrive.com/")).toBe(false);
    expect(isAppHost(pipedrive, "https://gmail.googleapis.com/")).toBe(false);
  });
});
