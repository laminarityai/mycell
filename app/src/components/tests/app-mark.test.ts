// The marks for the apps a workflow uses: each Google app, and so every app the catalog acts in,
// has its own; any other app (Microsoft 365, or one we don't know) shows a generic one. Every
// mark is named for screen readers and on hover.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { catalogActionSet } from "@/features/policy/catalog";
import { GOOGLE_APP_NAMES, GOOGLE_APPS } from "@/lib/google";
import { AppMark, AppMarks, appMarkOf } from "../app-mark";

describe("an app's mark", () => {
  it("is its own for each Google app, by the name the UI gives it", () => {
    for (const app of GOOGLE_APPS) expect(appMarkOf(GOOGLE_APP_NAMES[app])).toBe(app);
  });

  it("is its own for every app the catalog acts in", () => {
    const apps = catalogActionSet.actions.flatMap((action) =>
      action.kind === "catalog" && action.integration === "google" ? [action.app] : [],
    );

    expect(apps.length).toBeGreaterThan(0);
    for (const app of apps) expect(appMarkOf(app)).not.toBeNull();
  });

  it("is the generic one for any other app", () => {
    expect(appMarkOf("Microsoft 365")).toBeNull();
    expect(appMarkOf("Some new app")).toBeNull();
  });

  it("is named for screen readers and on hover, whichever glyph it has", () => {
    for (const app of ["Sheets", "Microsoft 365"]) {
      const html = renderToStaticMarkup(createElement(AppMark, { app }));

      expect(html).toContain(`role="img" aria-label="${app}"`);
      expect(html).toMatch(new RegExp(`aria-hidden="true"[^>]*>${app}</span>`));
    }
  });
});

describe("the apps a workflow uses", () => {
  it("are a named group of marks, one per app, in order", () => {
    const html = renderToStaticMarkup(
      createElement(AppMarks, { apps: ["Gmail", "Sheets", "Microsoft 365"] }),
    );

    expect(html).toContain(`role="group" aria-label="Apps it uses"`);
    expect([...html.matchAll(/role="img" aria-label="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "Gmail",
      "Sheets",
      "Microsoft 365",
    ]);
  });
});
