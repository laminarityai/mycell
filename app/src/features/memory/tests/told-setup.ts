// What the told-fact tests learn first: Dana at Acme writes to the company's sales inbox (an org
// connection), so everyone in org A can see Acme and its renewal contact.
import { seedTwoOrgs, type FixtureOrg } from "@/db/testing/two-org-fixture";
import { backfillConnection } from "@/features/discovery/server";
import { connectMailbox, daysAgo } from "@/testing/connect-helpers";
import { searchMemory } from "../server";
import { learnStoredItems, scriptLearning, withCredits } from "./memory-helpers";

export const DANA = "dana@acme.example";
export const PRIYA = "priya@globex.example";
export const SALES_FACT = "Acme's renewal contact is Sam Lee.";
export const PRIYA_NOTE = "Acme's renewals go through Priya, not Tom.";
export const TOM_NOTE = "Acme's renewals now go through Tom.";

const acmeObject = { ref: "acme", kind: "company" as const, name: "Acme", domain: "acme.example" };

/**
 * Connects an org inbox at `address` holding one email from Dana, and learns `statement` about
 * Acme from it (`predicate` renewal_contact), company-wide.
 */
export async function learnInInbox(
  org: FixtureOrg,
  address: string,
  text: string,
  statement: string,
  evidence: string,
  at = daysAgo(3),
) {
  const box = await connectMailbox(
    org.admin.ctx,
    address,
    [{ from: `Dana Ruiz <${DANA}>`, to: [address], subject: "Renewal", text, at }],
    "org",
  );
  await backfillConnection(org.admin.ctx, box.id);
  scriptLearning({
    objects: [acmeObject],
    facts: [{ about: "acme", statement, evidence, predicate: "renewal_contact", value: "Sam" }],
  });
  await learnStoredItems(org.id);
}

export async function setupTold() {
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  await withCredits(orgA.id);
  await learnInInbox(
    orgA,
    `sales@${orgA.workspaceDomain}`,
    "Hi, our renewal contact is Sam Lee at acme.example.",
    SALES_FACT,
    "our renewal contact is Sam Lee",
  );
  const found = await searchMemory(orgA.member.ctx, {
    key: { kind: "domain", value: "acme.example" },
  });
  const acme = found.objects.at(0);
  if (acme === undefined) throw new Error("Acme wasn't learned");
  return { ...orgs, acme, byAcme: { id: acme.id } };
}

export const byEmail = (value: string) => ({ key: { kind: "email" as const, value } });
