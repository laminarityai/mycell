// The registered apps' configuration (ADR-0018): what our team writes when registering an app.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { isAppHost, REGISTERED_APPS, registeredApps } from "../registered-apps";

// Vitest runs from `app/`, which the descriptions' paths are relative to.
const read = (path: string) => readFileSync(join(process.cwd(), path));

describe("the registered apps", () => {
  it("are Google and Microsoft 365, each on its own Nango integration", () => {
    expect(registeredApps.map((app) => [app.id, app.name, app.integration])).toEqual([
      ["google", "Google", "google"],
      ["microsoft", "Microsoft 365", "microsoft"],
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
      const description = JSON.parse(read(path).toString("utf8")) as {
        kind: string;
        rootUrl: string;
      };
      expect(description.kind).toBe("discovery#restDescription");
      expect(isAppHost(google, description.rootUrl)).toBe(true);
    }
  });

  it("keep Microsoft Graph's OpenAPI description, gzipped, served from Graph's host", () => {
    const microsoft = REGISTERED_APPS.microsoft;
    expect(microsoft.apiDescription.format).toBe("openapi");
    expect(microsoft.apiDescription.files).toHaveLength(1);
    for (const { path } of microsoft.apiDescription.files) {
      const head = gunzipSync(read(path)).subarray(0, 400).toString("utf8");
      expect(head).toMatch(/^openapi: 3\./);
      expect(head).toContain("servers:\n  - url: https://graph.microsoft.com/v1.0\n");
    }
    expect(isAppHost(microsoft, "https://graph.microsoft.com/v1.0")).toBe(true);
  });
});

describe("isAppHost", () => {
  it("accepts a URL on one of the app's own hosts", () => {
    expect(isAppHost(REGISTERED_APPS.google, "https://gmail.googleapis.com/gmail/v1/")).toBe(true);
    expect(isAppHost(REGISTERED_APPS.microsoft, "https://graph.microsoft.com/v1.0/me")).toBe(true);
  });

  it("refuses any other host, scheme or port", () => {
    const microsoft = REGISTERED_APPS.microsoft;
    for (const url of [
      "https://graph.microsoft.com.evil.example/v1.0/me",
      "https://evil.graph.microsoft.com/v1.0/me",
      "http://graph.microsoft.com/v1.0/me",
      "https://graph.microsoft.com:8443/v1.0/me",
      "https://login.microsoftonline.com/common",
      "not a url",
    ]) {
      expect(isAppHost(microsoft, url), url).toBe(false);
    }
    expect(isAppHost(REGISTERED_APPS.google, "https://graph.microsoft.com/")).toBe(false);
    expect(isAppHost(microsoft, "https://gmail.googleapis.com/")).toBe(false);
  });
});
