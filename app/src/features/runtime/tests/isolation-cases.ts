import { expect } from "vitest";
import { defineIsolationCases } from "@/db/testing/isolation";
import { FUNDED_CREDITS, type TwoOrgs } from "@/db/testing/two-org-fixture";
import { grantCredits } from "@/features/credits/server";
import { enable, switchWorkflowOn } from "@/features/workflows/server";
import { systemCtx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { connectGoogle } from "@/testing/connect-helpers";
import { fakeAiGateway } from "@/testing/fake-ai-gateway";
import { publishTo, tagUsers } from "@/testing/visibility-helpers";
import * as server from "../server";
import { inviteSpec } from "./calendar-helpers";
import { connectInbox, pricingQuestion, publish, threadSpec } from "./run-helpers";

// Org B has a workflow and a running run on its admin's inbox.
async function seedOrgBRun({ orgB }: TwoOrgs) {
  const inbox = await connectInbox(orgB.admin.ctx, orgB.admin.email, [pricingQuestion()]);
  const workflowId = await publish(orgB.admin.ctx, threadSpec());
  const { runId } = await server.startRun(
    orgB.admin.ctx,
    workflowId,
    inbox.connectionId,
    inbox.messages[0].id,
  );
  return { connectionId: inbox.connectionId, workflowId, runId };
}

// Org B's run failed (its job crashed), and org B has credits to retry it.
async function failedOrgBRun(orgs: TwoOrgs) {
  const seeded = await seedOrgBRun(orgs);
  await grantCredits(systemCtx(orgs.orgB.id), FUNDED_CREDITS);
  await server.failCrashedRun(systemCtx(orgs.orgB.id), seeded.runId);
  return seeded;
}

export const isolationCases = defineIsolationCases(server, {
  startRun: async (orgs) => {
    const orgB = await seedOrgBRun(orgs);
    const admin = orgs.orgA.admin.ctx;
    await connectInbox(admin, orgs.orgA.admin.email, []);
    const ownWorkflow = await publish(admin, threadSpec());

    await expect(server.startRun(admin, orgB.workflowId, orgB.connectionId, "m")).rejects.toThrow(
      NotFoundError,
    );
    await expect(server.startRun(admin, ownWorkflow, orgB.connectionId, "m")).rejects.toThrow(
      NotFoundError,
    );
    expect((await server.listRuns(orgs.orgB.admin.ctx, {})).runs).toHaveLength(1);
  },

  getRun: async (orgs) => {
    const { runId } = await seedOrgBRun(orgs);

    for (const ctx of [orgs.orgA.admin.ctx, orgs.orgA.member.ctx]) {
      await expect(server.getRun(ctx, runId)).rejects.toThrow(NotFoundError);
    }
    expect(await server.getRun(orgs.orgB.admin.ctx, runId)).toMatchObject({ id: runId });
  },

  getRunMessage: async (orgs) => {
    const { runId } = await seedOrgBRun(orgs);

    for (const ctx of [orgs.orgA.admin.ctx, orgs.orgA.member.ctx]) {
      await expect(server.getRunMessage(ctx, runId)).rejects.toThrow(NotFoundError);
    }
    expect(await server.getRunMessage(orgs.orgB.admin.ctx, runId)).toMatchObject({
      subject: pricingQuestion().subject,
    });
  },

  listRuns: async (orgs) => {
    const { workflowId, connectionId, runId } = await seedOrgBRun(orgs);
    const { orgA } = orgs;

    for (const ctx of [orgA.admin.ctx, orgA.member.ctx]) {
      expect((await server.listRuns(ctx, {})).runs).toEqual([]);
      expect((await server.listRuns(ctx, { workflowId, connectionId })).runs).toEqual([]);
      // A cursor naming org B's run finds nothing of it either.
      expect((await server.listRuns(ctx, {}, { olderThan: runId })).runs).toEqual([]);
    }
  },

  listRunFilters: async (orgs) => {
    await seedOrgBRun(orgs);
    const { orgA } = orgs;

    for (const ctx of [orgA.admin.ctx, orgA.member.ctx]) {
      expect(await server.listRunFilters(ctx)).toEqual({ workflows: [], connections: [] });
    }
    expect((await server.listRunFilters(orgs.orgB.admin.ctx)).workflows).toHaveLength(1);
  },

  pausingRuns: async (orgs) => {
    const { runId } = await seedOrgBRun(orgs);
    await server.failCrashedRun(systemCtx(orgs.orgB.id), runId);

    expect(await server.pausingRuns(orgs.orgA.admin.ctx, [runId])).toEqual([]);
    expect(await server.pausingRuns(orgs.orgB.admin.ctx, [runId])).toHaveLength(1);
  },

  startTriggeredRuns: async (orgs) => {
    // Org B's workflow is switched on for its admin's inbox; org A's fan-out is handed org B's
    // connection, as a forged or misrouted event would.
    const orgB = await seedOrgBRun(orgs);
    await switchWorkflowOn(orgs.orgB.admin.ctx, orgB.workflowId, orgB.connectionId);
    const event = {
      orgId: orgs.orgA.id,
      connectionId: orgB.connectionId,
      sourceRef: "message-1",
      occurredAt: new Date(Date.now() + 1000).toISOString(),
      labelIds: ["INBOX"],
    };

    expect(await server.startTriggeredRuns(systemCtx(orgs.orgA.id), event)).toEqual({
      runIds: [],
    });
    expect((await server.listRuns(orgs.orgB.admin.ctx, {})).runs).toHaveLength(1);
  },

  executeRun: async (orgs) => {
    const { runId } = await seedOrgBRun(orgs);

    expect(await server.executeRun(systemCtx(orgs.orgA.id), runId)).toEqual({
      status: "cancelled",
    });
    expect(await server.getRun(orgs.orgB.admin.ctx, runId)).toMatchObject({
      status: "running",
      steps: [],
    });
    expect(fakeAiGateway.requests()).toEqual([]);
  },

  failCrashedRun: async (orgs) => {
    const { runId } = await seedOrgBRun(orgs);

    await server.failCrashedRun(systemCtx(orgs.orgA.id), runId);

    expect(await server.getRun(orgs.orgB.admin.ctx, runId)).toMatchObject({
      status: "running",
      errorCode: null,
    });
  },

  searchMessages: async (orgs) => {
    const orgB = await seedOrgBRun(orgs);

    await expect(
      server.searchMessages(orgs.orgA.admin.ctx, orgB.connectionId, "pricing", 5),
    ).rejects.toThrow(NotFoundError);
    expect(
      await server.searchMessages(orgs.orgB.admin.ctx, orgB.connectionId, "pricing", 5),
    ).toHaveLength(1);
  },

  readMessage: async (orgs) => {
    const orgB = await seedOrgBRun(orgs);
    const refs = await server.searchMessages(orgs.orgB.admin.ctx, orgB.connectionId, "", 1);

    await expect(
      server.readMessage(orgs.orgA.admin.ctx, orgB.connectionId, refs.at(0)?.id ?? "missing"),
    ).rejects.toThrow(NotFoundError);
  },

  dryRun: async (orgs) => {
    const orgB = await seedOrgBRun(orgs);
    const admin = orgs.orgA.admin.ctx;
    await connectInbox(admin, orgs.orgA.admin.email, []);
    const refs = await server.searchMessages(orgs.orgB.admin.ctx, orgB.connectionId, "", 1);
    const sourceRef = refs.at(0)?.id ?? "missing";

    await expect(
      server.dryRun(admin, threadSpec(), { connectionId: orgB.connectionId, sourceRef }),
    ).rejects.toThrow(NotFoundError);
  },

  retryRun: async (orgs) => {
    const { runId } = await failedOrgBRun(orgs);

    for (const ctx of [orgs.orgA.admin.ctx, orgs.orgA.member.ctx]) {
      await expect(server.retryRun(ctx, runId)).rejects.toThrow(NotFoundError);
    }
    expect((await server.listRuns(orgs.orgB.admin.ctx, {})).runs).toHaveLength(1);
  },

  checkRetry: async (orgs) => {
    const { runId } = await failedOrgBRun(orgs);

    for (const ctx of [orgs.orgA.admin.ctx, orgs.orgA.member.ctx]) {
      await expect(server.checkRetry(ctx, runId)).rejects.toThrow(NotFoundError);
    }
    expect(await server.checkRetry(orgs.orgB.admin.ctx, runId)).toEqual({ allowed: true });
  },

  recentMessages: async (orgs) => {
    const orgB = await seedOrgBRun(orgs);
    await connectInbox(orgs.orgA.admin.ctx, orgs.orgA.admin.email, []);

    const listing = await server.recentMessages(orgs.orgA.admin.ctx);

    expect(listing.map((connection) => connection.connectionId)).not.toContain(orgB.connectionId);
    expect(listing).toHaveLength(1);
  },

  recentInvites: async (orgs) => {
    const orgB = await seedOrgBCalendar(orgs);
    orgB.calendar.invite({ title: "Intro", organizer: "ada@customer.test" });
    await connectGoogle(orgs.orgA.admin.ctx, orgs.orgA.admin.email);

    const listing = await server.recentInvites(orgs.orgA.admin.ctx);

    expect(listing.map((connection) => connection.connectionId)).not.toContain(orgB.connectionId);
    expect(listing).toEqual([expect.objectContaining({ messages: [] })]);
  },

  pollCalendar: async (orgs) => {
    const orgB = await seedOrgBCalendar(orgs);
    const { orgA } = orgs;
    const asked = orgB.calendar.listRequests.length;

    expect(await server.pollCalendar(systemCtx(orgA.id), orgB.connectionId)).toEqual({
      outcome: "gone",
    });
    for (const ctx of [orgA.admin.ctx, orgA.member.ctx]) {
      await expect(server.pollCalendar(ctx, orgB.connectionId)).rejects.toThrow(ForbiddenError);
    }
    expect(orgB.calendar.listRequests).toHaveLength(asked);
  },

  startInviteRuns: async (orgs) => {
    // Org A's fan-out is handed org B's invite, as a forged or misrouted event would be.
    const orgB = await seedOrgBCalendar(orgs);
    const invite = orgB.calendar.invite({ title: "Intro", organizer: "ada@customer.test" });
    const event = {
      orgId: orgs.orgA.id,
      connectionId: orgB.connectionId,
      sourceRef: invite.id,
      occurredAt: new Date(Date.now() + 1000).toISOString(),
    };

    expect(await server.startInviteRuns(systemCtx(orgs.orgA.id), event)).toEqual({ runIds: [] });
    expect(
      (await server.listRuns(orgs.orgB.admin.ctx, { workflowId: orgB.workflowId })).runs,
    ).toEqual([]);
  },

  // Cross-org by design: it lists every org's calendars for the cron. What it must keep
  // straight is which org each poll acts in: always the connection's own.
  calendarsDue: async (orgs) => {
    const orgB = await seedOrgBCalendar(orgs);

    expect(await server.calendarsDue()).toEqual([
      { orgId: orgs.orgB.id, connectionId: orgB.connectionId },
    ]);
  },
});

// Org B's admin has a Calendar-triggered workflow switched on for their own connection, whose
// calendar has been synced once.
async function seedOrgBCalendar({ orgB }: TwoOrgs) {
  const { admin } = orgB;
  const google = await connectGoogle(admin.ctx, admin.email);
  await grantCredits(systemCtx(orgB.id), 100);
  await tagUsers(admin.ctx, "sales", [admin]);
  const { workflowId } = await publishTo(admin.ctx, "Invites", inviteSpec(), ["sales"]);
  await enable(admin.ctx, workflowId);
  await server.pollCalendar(systemCtx(orgB.id), google.id);
  return { connectionId: google.id, calendar: google.calendar, workflowId };
}
