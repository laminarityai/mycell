import { asc, eq, sql } from "drizzle-orm";
import { integer, pgTable, serial, text } from "drizzle-orm/pg-core";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../client";
import { forOrg } from "../for-org";
import { resetDatabase } from "../testing/reset";
import { seedTwoOrgs, type TwoOrgs } from "../testing/two-org-fixture";

// A tenant-owned table that exists only in tests: it has no migration.
const notes = pgTable("test_notes", {
  id: serial("id").primaryKey(),
  orgId: text("org_id").notNull(),
  body: text("body").notNull(),
  position: integer("position").notNull().default(0),
});

let orgs: TwoOrgs;

beforeAll(async () => {
  await getDb().execute(sql`
    create table if not exists test_notes (
      id serial primary key,
      org_id text not null references organization(id) on delete cascade,
      body text not null,
      position integer not null default 0
    )
  `);
});

beforeEach(async () => {
  await resetDatabase();
  orgs = await seedTwoOrgs();
  await forOrg(orgs.orgA.admin.ctx).insert(notes, [
    { body: "a1", position: 1 },
    { body: "a2", position: 2 },
  ]);
  await forOrg(orgs.orgB.admin.ctx).insert(notes, { body: "b1", position: 1 });
});

const bodies = (rows: { body: string }[]) => rows.map((row) => row.body).sort();

describe("forOrg(ctx).select", () => {
  it("returns only the caller's org's rows", async () => {
    expect(bodies(await forOrg(orgs.orgA.member.ctx).select(notes))).toEqual(["a1", "a2"]);
    expect(bodies(await forOrg(orgs.orgB.member.ctx).select(notes))).toEqual(["b1"]);
  });

  it("can't reach another org's row even when the filter names it", async () => {
    const rows = await forOrg(orgs.orgA.admin.ctx).select(notes, {
      where: eq(notes.body, "b1"),
    });
    expect(rows).toEqual([]);
  });

  it("applies the caller's filter, order, and limit within the org", async () => {
    const rows = await forOrg(orgs.orgA.admin.ctx).select(notes, {
      orderBy: [asc(notes.position)],
      limit: 1,
    });
    expect(rows.map((row) => row.body)).toEqual(["a1"]);
  });
});

describe("forOrg(ctx).insert", () => {
  it("sets org_id from ctx", async () => {
    const rows = await forOrg(orgs.orgB.member.ctx).insert(notes, { body: "b2" });
    expect(rows).toMatchObject([{ body: "b2", orgId: orgs.orgB.id }]);
  });

  it("ignores a caller-supplied org_id", async () => {
    const smuggled = { body: "sneaky", orgId: orgs.orgB.id };
    const rows = await forOrg(orgs.orgA.member.ctx).insert(notes, smuggled);

    expect(rows).toMatchObject([{ body: "sneaky", orgId: orgs.orgA.id }]);
    expect(bodies(await forOrg(orgs.orgB.admin.ctx).select(notes))).toEqual(["b1"]);
  });

  it("skips conflicting rows when asked, returning only the rows it inserted", async () => {
    const existing = (
      await forOrg(orgs.orgA.admin.ctx).select(notes, { where: eq(notes.body, "a1") })
    ).at(0);
    if (existing === undefined) throw new Error("a1 wasn't seeded");

    const rows = await forOrg(orgs.orgA.admin.ctx).insert(
      notes,
      [{ id: existing.id, body: "duplicate" }, { body: "a3" }],
      { onConflictDoNothing: true },
    );

    expect(rows.map((row) => row.body)).toEqual(["a3"]);
    expect(bodies(await forOrg(orgs.orgA.admin.ctx).select(notes))).toEqual(["a1", "a2", "a3"]);
  });
});

describe("forOrg(ctx).update", () => {
  it("changes only the caller's org's rows", async () => {
    await forOrg(orgs.orgA.admin.ctx).update(notes, { body: "edited" });

    expect(bodies(await forOrg(orgs.orgA.admin.ctx).select(notes))).toEqual(["edited", "edited"]);
    expect(bodies(await forOrg(orgs.orgB.admin.ctx).select(notes))).toEqual(["b1"]);
  });

  it("can't touch another org's row even when the filter names it", async () => {
    const updated = await forOrg(orgs.orgA.admin.ctx).update(
      notes,
      { body: "hijacked" },
      eq(notes.body, "b1"),
    );

    expect(updated).toEqual([]);
    expect(bodies(await forOrg(orgs.orgB.admin.ctx).select(notes))).toEqual(["b1"]);
  });

  it("ignores a caller-supplied org_id, so rows can't move to another org", async () => {
    const smuggled = { body: "moved", orgId: orgs.orgB.id };
    await forOrg(orgs.orgA.admin.ctx).update(notes, smuggled, eq(notes.body, "a1"));

    expect(bodies(await forOrg(orgs.orgA.admin.ctx).select(notes))).toEqual(["a2", "moved"]);
    expect(bodies(await forOrg(orgs.orgB.admin.ctx).select(notes))).toEqual(["b1"]);
  });
});

describe("forOrg(ctx).delete", () => {
  it("deletes only the caller's org's rows", async () => {
    await forOrg(orgs.orgA.admin.ctx).delete(notes);

    expect(await forOrg(orgs.orgA.admin.ctx).select(notes)).toEqual([]);
    expect(bodies(await forOrg(orgs.orgB.admin.ctx).select(notes))).toEqual(["b1"]);
  });

  it("can't delete another org's row even when the filter names it", async () => {
    const deleted = await forOrg(orgs.orgA.admin.ctx).delete(notes, eq(notes.body, "b1"));

    expect(deleted).toEqual([]);
    expect(bodies(await forOrg(orgs.orgB.admin.ctx).select(notes))).toEqual(["b1"]);
  });
});

describe("forOrg(ctx).transaction", () => {
  it("commits every write together, still inside the caller's org", async () => {
    const result = await forOrg(orgs.orgA.admin.ctx).transaction(async (tx) => {
      await tx.insert(notes, { body: "a3" });
      await tx.update(notes, { body: "b1-hijacked" }, eq(notes.body, "b1"));
      return (await tx.select(notes)).length;
    });

    expect(result).toBe(3);
    expect(bodies(await forOrg(orgs.orgA.admin.ctx).select(notes))).toEqual(["a1", "a2", "a3"]);
    expect(bodies(await forOrg(orgs.orgB.admin.ctx).select(notes))).toEqual(["b1"]);
  });

  it("undoes every write when the function throws", async () => {
    const failing = forOrg(orgs.orgA.admin.ctx).transaction(async (tx) => {
      await tx.insert(notes, { body: "a3" });
      await tx.delete(notes, eq(notes.body, "a1"));
      throw new Error("halfway");
    });

    await expect(failing).rejects.toThrow("halfway");
    expect(bodies(await forOrg(orgs.orgA.admin.ctx).select(notes))).toEqual(["a1", "a2"]);
  });
});
