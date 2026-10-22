import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "@/db/testing/reset";
import { seedTwoOrgs } from "@/db/testing/two-org-fixture";
import { backfillConnection, pollConnection } from "@/features/discovery/server";
import { systemCtx } from "@/lib/ctx";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { connectMailbox, daysAgo } from "@/testing/connect-helpers";
import type { FakeMessageInput } from "@/testing/fake-gmail";
import { applyRetention, getMemorySettings, readObject, setRetentionWindow } from "../server";
import {
  grantOnly,
  learnStoredItems,
  scriptLearning,
  withCredits,
  type ScriptedExtraction,
} from "./memory-helpers";

beforeEach(resetDatabase);

const MARCH = "Acme's renewal is due in March.";
const MAY = "Acme's renewal has moved to May.";
const SEATS = "Acme has 40 seats.";
const WIDGETS = "Globex buys widgets from us.";

const acme = { ref: "acme", kind: "company" as const, name: "Acme", domain: "acme.example" };
const globex = {
  ref: "globex",
  kind: "company" as const,
  name: "Globex",
  domain: "globex.example",
};
const byDomain = (value: string) => ({ key: { kind: "domain" as const, value } });

const renewal = (statement: string, evidence: string, value: string) => ({
  about: "acme",
  statement,
  evidence,
  predicate: "renewal_date",
  value,
});
const seats = { about: "acme", statement: SEATS, evidence: "We have 40 seats" };

// Org A's member learned, 16 months ago, that Acme renews in March and has 40 seats, and that
// Globex buys widgets; and last week that Acme's renewal moved to May, with 40 seats still.
async function setup() {
  const orgs = await seedTwoOrgs();
  const { orgA } = orgs;
  await withCredits(orgA.id);
  const box = await connectMailbox(orgA.member.ctx, orgA.member.email, []);
  await backfillConnection(orgA.member.ctx, box.id);
  const learn = async (message: Omit<FakeMessageInput, "to">, extraction: ScriptedExtraction) => {
    box.mailbox.add({ to: [orgA.member.email], ...message });
    await pollConnection(systemCtx(orgA.id), box.id);
    scriptLearning(extraction);
    return learnStoredItems(orgA.id);
  };
  await learn(
    {
      from: "Dana Ruiz <dana@acme.example>",
      text: "Our renewal at acme.example is due in March. We have 40 seats.",
      at: daysAgo(490),
    },
    {
      objects: [acme],
      facts: [renewal(MARCH, "Our renewal at acme.example is due in March", "March"), seats],
    },
  );
  await learn(
    {
      from: "Kim Lee <kim@globex.example>",
      text: "At globex.example we buy widgets from you.",
      at: daysAgo(480),
    },
    {
      objects: [globex],
      facts: [{ about: "globex", statement: WIDGETS, evidence: "we buy widgets from you" }],
    },
  );
  await learn(
    {
      from: "Dana Ruiz <dana@acme.example>",
      text: "Our renewal at acme.example has moved to May. We have 40 seats.",
      at: daysAgo(7),
    },
    {
      objects: [acme],
      facts: [renewal(MAY, "Our renewal at acme.example has moved to May", "May"), seats],
    },
  );
  return orgs;
}

const statements = (facts: { statement: string }[]) => facts.map((fact) => fact.statement).sort();

describe("the retention window", () => {
  it("keeps everything 24 months by default", async () => {
    const { orgA } = await setup();

    expect(await applyRetention(systemCtx(orgA.id))).toEqual({
      sourceRecords: 0,
      facts: 0,
      objects: 0,
    });

    const acmeNow = await readObject(orgA.member.ctx, byDomain("acme.example"));
    expect(statements(acmeNow.facts)).toEqual([MAY, SEATS].sort());
    expect(statements(acmeNow.history)).toEqual([MARCH]);
    expect((await getMemorySettings(orgA.admin.ctx)).started?.retentionMonths).toBe(24);
  });

  it("once shortened, removes sources past it on the next run, with what only they taught", async () => {
    const { orgA } = await setup();

    await setRetentionWindow(orgA.admin.ctx, { months: "12" });
    expect((await getMemorySettings(orgA.admin.ctx)).started?.retentionMonths).toBe(12);

    // The old renewal (history now) and Globex's fact go; the seats, which last week's email
    // also states, stay.
    expect(await applyRetention(systemCtx(orgA.id))).toEqual({
      sourceRecords: 2,
      facts: 2,
      objects: 1,
    });
    const acmeNow = await readObject(orgA.member.ctx, byDomain("acme.example"));
    expect(statements(acmeNow.facts)).toEqual([MAY, SEATS].sort());
    expect(acmeNow.history).toEqual([]);
    expect(acmeNow.facts.find((fact) => fact.statement === SEATS)?.sources).toHaveLength(1);
    await expect(readObject(orgA.member.ctx, byDomain("globex.example"))).rejects.toThrow(
      NotFoundError,
    );
    // A second run finds nothing more.
    expect(await applyRetention(systemCtx(orgA.id))).toEqual({
      sourceRecords: 0,
      facts: 0,
      objects: 0,
    });
  });

  it("is set by admins only, in whole months up to 24, once memory has started", async () => {
    const { orgA, orgB } = await setup();
    await grantOnly(orgB.id);

    await expect(setRetentionWindow(orgA.member.ctx, { months: 6 })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(setRetentionWindow(systemCtx(orgA.id), { months: 6 })).rejects.toThrow(
      ForbiddenError,
    );
    for (const months of [0, 25, 1.5, "a year"]) {
      await expect(setRetentionWindow(orgA.admin.ctx, { months })).rejects.toThrow(ValidationError);
    }
    await expect(setRetentionWindow(orgB.admin.ctx, { months: 6 })).rejects.toThrow(ConflictError);
    await expect(applyRetention(orgA.admin.ctx)).rejects.toThrow(ForbiddenError);
    expect((await getMemorySettings(orgA.admin.ctx)).started?.retentionMonths).toBe(24);
  });
});
