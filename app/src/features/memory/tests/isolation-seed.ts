// What memory's isolation cases seed in org B: what org A must neither see nor change.
import type { FixtureOrg, TwoOrgs } from "@/db/testing/two-org-fixture";
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

/**
 * Org B's sales inbox, an org connection, hears from Dana too, so memory learns a company-wide
 * fact about her: one every reader in org B sees.
 */
export async function learnInOrgInbox(orgB: FixtureOrg) {
  const inbox = `sales@${orgB.workspaceDomain}`;
  const mailbox = await connectMailbox(
    orgB.admin.ctx,
    inbox,
    [
      {
        from: `Dana Ruiz <${DANA}>`,
        to: [inbox],
        text: "I run procurement for our offices.",
        at: daysAgo(1),
      },
    ],
    "org",
  );
  await backfillConnection(orgB.admin.ctx, mailbox.id);
  scriptLearning({
    objects: [{ ref: "dana", kind: "person", name: "Dana Ruiz", email: DANA }],
    facts: [
      {
        about: "dana",
        statement: "Dana Ruiz runs procurement for Acme's offices.",
        evidence: "I run procurement for our offices",
      },
    ],
  });
  await learnStoredItems(orgB.id);
}
