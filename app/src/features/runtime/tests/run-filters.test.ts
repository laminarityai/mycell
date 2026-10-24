// The Runs page's filters and paging: what each filter offers and finds, and Newer and Older
// across page boundaries.
import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import type { Ctx } from "@/lib/ctx";
import { listRunFilters, listRuns } from "../server";
import type { RunFilters, RunStatus } from "../types";
import { company } from "./company-runs";

beforeEach(resetDatabase);

describe("listRunFilters", () => {
  it("offers an admin the workflows and inboxes the company's runs are on", async () => {
    const { orgA, admin, own, colleague, shared, sales, memberWorkflow, orgWorkflow, run } =
      await company();
    await run("own", "succeeded");
    await run("colleague", "failed");
    await run("org", "running");

    expect(await listRunFilters(admin)).toEqual({
      workflows: [
        { id: memberWorkflow, name: "replies" },
        { id: orgWorkflow, name: "sales" },
      ],
      connections: expect.arrayContaining([
        { id: own.connectionId, inbox: { kind: "yours", accountEmail: orgA.admin.email } },
        { id: colleague.connectionId, inbox: { kind: "colleague", ownerName: orgA.member.email } },
        { id: shared.id, inbox: { kind: "org", accountEmail: sales } },
      ]) as unknown,
    });
  });

  it("offers a member only what their own runs are on", async () => {
    const { orgA, member, colleague, memberWorkflow, run } = await company();
    await run("own", "succeeded");
    await run("org", "succeeded");
    expect(await listRunFilters(member)).toEqual({ workflows: [], connections: [] });
    await run("colleague", "succeeded");

    expect(await listRunFilters(member)).toEqual({
      workflows: [{ id: memberWorkflow, name: "replies" }],
      connections: [
        { id: colleague.connectionId, inbox: { kind: "yours", accountEmail: orgA.member.email } },
      ],
    });
  });
});

// Each page's run IDs, oldest page last, following `older` from the newest page.
async function everyPage(ctx: Ctx, filters: RunFilters, size: number) {
  const pages: string[][] = [];
  let page = await listRuns(ctx, filters, { size });
  pages.push(page.runs.map((run) => run.id));
  while (page.older !== null) {
    page = await listRuns(ctx, filters, { olderThan: page.older, size });
    pages.push(page.runs.map((run) => run.id));
  }
  return { pages, last: page };
}

describe("filtering and paging runs", () => {
  async function eightRuns() {
    const setup = await company();
    const plan: ["own" | "colleague" | "org", RunStatus][] = [
      ["own", "failed"],
      ["org", "succeeded"],
      ["own", "succeeded"],
      ["colleague", "failed"],
      ["org", "failed"],
      ["own", "running"],
      ["colleague", "failed"],
      ["own", "failed"],
    ];
    const started: { id: string; on: string; status: RunStatus }[] = [];
    for (const [on, status] of plan) started.push({ id: await setup.run(on, status), on, status });
    // Newest first, as the list shows them.
    return { ...setup, started: started.reverse() };
  }

  it("pages every failed run, newest first, and back again", async () => {
    const { admin, started } = await eightRuns();
    const failed = started.filter((run) => run.status === "failed").map((run) => run.id);

    const { pages, last } = await everyPage(admin, { status: "failed" }, 2);

    expect(pages).toEqual([failed.slice(0, 2), failed.slice(2, 4), failed.slice(4)]);
    // Newer from the last page goes back a page at a time.
    const middle = await listRuns(
      admin,
      { status: "failed" },
      {
        newerThan: last.newer ?? "",
        size: 2,
      },
    );
    expect(middle.runs.map((run) => run.id)).toEqual(failed.slice(2, 4));
    const first = await listRuns(
      admin,
      { status: "failed" },
      {
        newerThan: middle.newer ?? "",
        size: 2,
      },
    );
    expect(first.runs.map((run) => run.id)).toEqual(failed.slice(0, 2));
    expect(first.newer).toBeNull();
    expect(first.older).toBe(failed[1]);
  });

  it("filters by workflow, by connection, and by both with a status", async () => {
    const { admin, colleague, shared, orgWorkflow, memberWorkflow, started } = await eightRuns();
    const ids = (on: string, status?: RunStatus) =>
      started
        .filter((run) => run.on === on && (status === undefined || run.status === status))
        .map((run) => run.id);

    const byWorkflow = await everyPage(admin, { workflowId: orgWorkflow }, 3);
    const byConnection = await everyPage(admin, { connectionId: colleague.connectionId }, 3);
    const both = await listRuns(admin, {
      workflowId: memberWorkflow,
      connectionId: shared.id,
      status: "succeeded",
    });

    expect(byWorkflow.pages.flat()).toEqual(ids("org"));
    expect(byConnection.pages.flat()).toEqual(ids("colleague"));
    expect(both.runs).toEqual([]);
    const ownSucceeded = await listRuns(admin, { workflowId: memberWorkflow, status: "succeeded" });
    expect(ownSucceeded.runs.map((run) => run.id)).toEqual(ids("own", "succeeded"));
  });

  it("starts again from the newest page when a page's run is gone", async () => {
    const { admin, started } = await eightRuns();

    const page = await listRuns(admin, {}, { olderThan: "no-such-run", size: 3 });

    expect(page.runs.map((run) => run.id)).toEqual(started.slice(0, 3).map((run) => run.id));
    expect(page.newer).toBeNull();
  });
});
