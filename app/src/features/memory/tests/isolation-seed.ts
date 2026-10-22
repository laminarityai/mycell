// What memory's isolation cases seed in org B: what org A must neither see nor change.
import type { TwoOrgs } from "@/db/testing/two-org-fixture";
import { backfillConnection } from "@/features/discovery/server";
import { connectMailbox, daysAgo } from "@/testing/connect-helpers";
import * as server from "../server";
import { learnStoredItems, scriptLearning, withCredits } from "./memory-helpers";

export const DANA = "dana@acme.example";
export const byEmail = { key: { kind: "email" as const, value: DANA } };

// Org B's member hears from Dana at Acme, and memory learns about her: org A must neither see
// it nor change it.
export async function seedOrgB({ orgB }: TwoOrgs) {
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
