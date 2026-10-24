// The apps a workflow uses, shown as marks on members' cards and in the admin's list (#169): an
// org switch shows its shared inbox too, and a pause a new app caused names it with its mark.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { connectGoogle } from "@/testing/connect-helpers";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import {
  enable,
  getVisibleWorkflow,
  listVisibleWorkflows,
  listWorkflows,
  publishWorkflow,
  saveWorkflow,
  switchWorkflowOn,
} from "../server";
import { PausedNotice, VisibleWorkflowsList, WorkflowsList } from "../ui";
import { labelSpec, sheetSpec } from "./specs";

beforeEach(resetDatabase);

// Org A, in credit: the member has `sales`, and three workflows are published to it: one on
// Gmail alone, one on Gmail and Sheets, and one on the shared support inbox, switched on there.
async function published() {
  const { orgA } = await seedTwoOrgs({ credits: 100 });
  const { admin, member } = orgA;
  await connectGoogle(admin.ctx, admin.email);
  await connectGoogle(member.ctx, member.email);
  const support = await connectGoogle(admin.ctx, "support@org-a.test", { kind: "org" });
  await tagUsers(admin.ctx, "sales", [member]);
  const labels = await publishTo(admin.ctx, "Labels", labelSpec(), ["sales"]);
  const prices = await publishTo(admin.ctx, "Prices", sheetSpec(), ["sales"]);
  const shared = await publishTo(
    admin.ctx,
    "Shared labels",
    labelSpec({ id: "shared-labels", credentials: "org" }),
    ["sales"],
  );
  await switchWorkflowOn(admin.ctx, shared.workflowId, support.id);
  return { admin, member, labels, prices, shared };
}

// The marks in `html`, by the names screen readers read, in order.
function marks(html: string): string[] {
  return [...html.matchAll(/role="img" aria-label="([^"]+)"/g)].map((match) => match[1]);
}

// One card's or row's markup, from its name to the next one's.
function section(html: string, from: string, to?: string): string {
  const start = html.indexOf(from);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = to === undefined ? html.length : html.indexOf(to, start + from.length);
  return html.slice(start, end === -1 ? html.length : end);
}

const render = (element: ReactElement) => renderToStaticMarkup(element);

describe("a member's workflow cards", () => {
  it("show each workflow's apps as marks, and an org switch's shared inbox", async () => {
    const { member } = await published();

    const html = render(
      createElement(VisibleWorkflowsList, { workflows: await listVisibleWorkflows(member.ctx) }),
    );

    expect(marks(section(html, ">Labels<", ">Prices<"))).toEqual(["Gmail"]);
    expect(marks(section(html, ">Prices<", ">Shared labels<"))).toEqual(["Gmail", "Sheets"]);
    const shared = section(html, ">Shared labels<");
    expect(marks(shared)).toEqual(["Gmail", "Shared inbox support@org-a.test"]);
    expect(shared).toContain("Runs on the shared inbox support@org-a.test, managed by admins.");
    expect(html).not.toContain("Needs");
  });

  it("know an org switch's shared inbox, and no inbox for a member workflow or one that's off", async () => {
    const { admin, member, labels, shared } = await published();

    expect((await getVisibleWorkflow(member.ctx, shared.workflowId)).sharedInbox).toBe(
      "support@org-a.test",
    );
    expect((await getVisibleWorkflow(member.ctx, labels.workflowId)).sharedInbox).toBeNull();

    const off = await publishTo(
      admin.ctx,
      "Shared but off",
      labelSpec({ id: "shared-off", credentials: "org" }),
      ["sales"],
    );
    expect((await getVisibleWorkflow(member.ctx, off.workflowId)).sharedInbox).toBeNull();
  });
});

describe("the admin's workflow list", () => {
  it("shows each published workflow's apps, and none for one not yet published", async () => {
    const { admin } = await published();
    await saveWorkflow(admin.ctx, { name: "Unpublished", spec: labelSpec({ id: "draft-only" }) });
    const workflows = await listWorkflows(admin.ctx);

    const html = render(
      createElement(WorkflowsList, {
        workflows,
        enablements: new Map(),
        orgConnections: new Map(),
      }),
    );

    expect(workflows.find((workflow) => workflow.name === "Prices")?.requiredApps).toEqual([
      "Gmail",
      "Sheets",
    ]);
    expect(marks(section(html, ">Prices<", ">Shared labels<"))).toEqual(["Gmail", "Sheets"]);
    expect(marks(section(html, ">Unpublished<"))).toEqual([]);
  });
});

describe("a pause a new app caused", () => {
  it("names the app with its mark", async () => {
    const { admin, member, labels } = await published();
    await enable(member.ctx, labels.workflowId);
    const withSheets = labelSpec({
      steps: [
        ...(labelSpec().steps as unknown[]),
        {
          id: "prices",
          type: "tool",
          action: "google-sheet.read-range",
          input: { spreadsheetId: "sheet-1", range: "Prices!A1:C50" },
        },
      ],
      visibility: { tags: ["sales"] },
    });
    await saveWorkflow(admin.ctx, {
      workflowId: labels.workflowId,
      name: "Labels",
      spec: withSheets,
    });
    await publishWorkflow(admin.ctx, labels.workflowId);

    const current = (await getVisibleWorkflow(member.ctx, labels.workflowId)).switch;
    const notice = render(createElement(PausedNotice, { current }));

    expect(current?.pausedChange?.newApps).toEqual(["Sheets"]);
    const changed = section(notice, `aria-label="What changed"`);
    expect(changed).toMatch(
      /It now uses (<[^>]+>)*<svg aria-hidden="true"[^]*?<\/svg>Sheets(<\/[^>]+>)*\./,
    );
  });
});
