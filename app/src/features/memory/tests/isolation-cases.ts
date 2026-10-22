import { expect } from "vitest";
import { defineIsolationCases } from "@/db/testing/isolation";
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { backfillConnection } from "@/features/discovery/server";
import { systemCtx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { connectMailbox, daysAgo } from "@/testing/connect-helpers";
import * as server from "../server";
import { learnStoredItems, scriptLearning, withCredits } from "./memory-helpers";

const DANA = "dana@acme.example";
const byEmail = { key: { kind: "email" as const, value: DANA } };

// Org B's member hears from Dana at Acme, and memory learns about her: org A must neither see
// it nor change it.
async function seedOrgB({ orgB }: TwoOrgs) {
  await withCredits(orgB.id);
  const mailbox = await connectMailbox(orgB.member.ctx, orgB.member.email, [
    {
      from: `Dana Ruiz <${DANA}>`,
      to: [orgB.member.email],
      text: "I lead procurement at Acme.",
      at: daysAgo(1),
    },
  ]);
  await backfillConnection(orgB.member.ctx, mailbox.id);
  scriptLearning({
    objects: [{ ref: "dana", kind: "person", name: "Dana Ruiz", email: DANA }],
    facts: [
      {
        about: "dana",
        statement: "Dana Ruiz leads procurement at Acme.",
        evidence: "I lead procurement at Acme",
      },
    ],
  });
  await learnStoredItems(orgB.id);
  const message = (mailbox.mailbox.list(new URLSearchParams()).messages ?? []).at(0);
  const snapshot = () => server.readObject(orgB.member.ctx, byEmail);
  return { mailbox, sourceRef: message?.id ?? "", object: await snapshot(), snapshot };
}

export const isolationCases = defineIsolationCases(server, {
  learnFromItem: async (orgs) => {
    const { mailbox, sourceRef, snapshot } = await seedOrgB(orgs);
    const before = await snapshot();
    const { orgA } = orgs;
    const item = { connectionId: mailbox.id, app: "gmail" as const, sourceRef };

    expect(await server.learnFromItem(systemCtx(orgA.id), item)).toEqual({ outcome: "gone" });
    for (const ctx of [orgA.admin.ctx, orgA.member.ctx]) {
      await expect(server.learnFromItem(ctx, item)).rejects.toThrow(ForbiddenError);
    }

    expect(await snapshot()).toEqual(before);
  },

  readObject: async (orgs) => {
    const { object, snapshot } = await seedOrgB(orgs);
    const { orgA } = orgs;

    for (const ctx of [orgA.admin.ctx, orgA.member.ctx, systemCtx(orgA.id)]) {
      await expect(server.readObject(ctx, { id: object.id })).rejects.toThrow(NotFoundError);
      await expect(server.readObject(ctx, byEmail)).rejects.toThrow(NotFoundError);
    }

    expect(await snapshot()).toEqual(object);
  },
});
