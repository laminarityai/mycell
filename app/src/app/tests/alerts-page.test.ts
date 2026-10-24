// The Alerts page as an admin reads it: a one-line summary, then the open alerts grouped by how
// much they stop, each with what it's about and its one fix; or that nothing needs them.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { listAlerts } from "@/features/alerts/server";
import { AlertsOverview, OutOfCreditsBanner } from "@/features/alerts/ui";
import { grantCredits } from "@/features/credits/server";
import { type Ctx, systemCtx } from "@/lib/ctx";
import { connectGoogle, deliver } from "@/testing/connect-helpers";
import { fakeNango } from "@/testing/fake-nango";

beforeEach(resetDatabase);

const textOf = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");

async function page(ctx: Ctx) {
  return renderToStaticMarkup(createElement(AlertsOverview, { alerts: await listAlerts(ctx) }));
}

describe("the Alerts page", () => {
  it("groups the open alerts by how much they stop, each with its fix", async () => {
    const { orgA } = await seedTwoOrgs();
    const support = `support@${orgA.workspaceDomain}`;
    const shared = await connectGoogle(orgA.admin.ctx, support, { kind: "org" });
    await deliver(fakeNango.authWebhook(shared.nangoConnectionId, "refresh", false));

    const html = await page(orgA.admin.ctx);
    const text = textOf(html);

    expect(text).toContain(
      "2 open alerts, one of them stopping everything. They clear by themselves once fixed.",
    );
    // Most urgent first.
    expect(text.indexOf("Stops everything (1)")).toBeLessThan(
      text.indexOf("Stops a workflow or an inbox (1)"),
    );
    expect(text).not.toContain("Can wait a day");
    expect(text).toContain("Out of credits");
    expect(text).toContain(`${support}Org connection`);
    expect(text).toContain("Once it's reconnected.");
    expect(html).toContain('href="/connections"');
    expect(html).toContain('href="/credits"');
  });

  it("says nothing needs the admin when nothing does", async () => {
    const { orgA } = await seedTwoOrgs();
    await grantCredits(systemCtx(orgA.id), 1000, "October allowance");

    const text = textOf(await page(orgA.admin.ctx));

    expect(text).toContain("Nothing needs you.");
    expect(text).not.toContain("open alert");
  });
});

describe("the out-of-credits banner", () => {
  it("says every workflow is paused and links to Credits", () => {
    const html = renderToStaticMarkup(createElement(OutOfCreditsBanner));

    expect(textOf(html)).toContain("Your company is out of credits.");
    expect(html).toContain('href="/credits"');
  });
});
