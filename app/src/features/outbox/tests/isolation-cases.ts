import { expect } from "vitest";
import { defineIsolationCases } from "@/db/testing/isolation";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { tagDeleted } from "@/features/tags/events";
import { systemCtx, type Ctx } from "@/lib/ctx";
import { fakeInngest } from "@/testing/fake-inngest";
import * as server from "../server";

const later = () => new Date(Date.now() + 61_000);

// Writes one event to the org's outbox that its send leaves waiting.
async function waitingEvent(ctx: Ctx, id: string) {
  fakeInngest.failSends();
  await server.saveWithEvents(ctx, (_tx, emit) => {
    emit(tagDeleted, { orgId: ctx.orgId, tagId: id }, `tag-deleted-${id}`);
    return Promise.resolve();
  });
  fakeInngest.failSends(false);
}

async function seedOrgBEvent({ orgB }: TwoOrgs) {
  await waitingEvent(orgB.admin.ctx, "tag-b");
}

export const isolationCases = defineIsolationCases(server, {
  saveWithEvents: async (orgs) => {
    await seedOrgBEvent(orgs);

    await waitingEvent(orgs.orgA.admin.ctx, "tag-a");

    // Org A's event waits in org A, and org B's is still org B's alone.
    expect(await server.sendWaitingEvents(systemCtx(orgs.orgA.id), later())).toEqual({ sent: 1 });
    expect(fakeInngest.sent().map((event) => event.data.orgId)).toEqual([orgs.orgA.id]);
  },

  sendWaitingEvents: async (orgs) => {
    await seedOrgBEvent(orgs);

    expect(await server.sendWaitingEvents(systemCtx(orgs.orgA.id), later())).toEqual({ sent: 0 });
    expect(fakeInngest.sent()).toEqual([]);
    expect(await server.listOrgsWithWaitingEvents(later())).toEqual([orgs.orgB.id]);
  },

  // Cross-org by design (ADR-0027): it reads which orgs have events waiting, and only their IDs.
  listOrgsWithWaitingEvents: async (orgs) => {
    await seedOrgBEvent(orgs);
    await waitingEvent(orgs.orgA.admin.ctx, "tag-a");

    expect(await server.listOrgsWithWaitingEvents(later())).toEqual(
      [orgs.orgA.id, orgs.orgB.id].sort(),
    );
  },
});
