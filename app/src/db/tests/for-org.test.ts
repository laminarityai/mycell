import { asc, desc, eq, sql } from "drizzle-orm";
import { integer, pgTable, serial, text } from "drizzle-orm/pg-core";
import { beforeAll, beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import { getDb } from "../client";
import { forOrg } from "../for-org";
import { countQueries } from "../testing/count-queries";
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
  // Every foreign key is indexed (foreign-key-indexes.test.ts), this table's too.
  await getDb().execute(
    sql`create index if not exists test_notes_org_id_idx on test_notes (org_id)`,
  );
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

  it("keeps the first row of each distinct value, never another org's", async () => {
    await forOrg(orgs.orgA.admin.ctx).insert(notes, { body: "a0", position: 1 });

    // Within position 1, b1 sorts first: it would win if the filter let it in.
    const rows = await forOrg(orgs.orgA.admin.ctx).select(notes, {
      distinctOn: [notes.position],
      orderBy: [asc(notes.position), desc(notes.body)],
    });

    expect(rows.map((row) => row.body)).toEqual(["a1", "a2"]);
  });

  it("reads only the named columns, still within the org", async () => {
    const rows = await forOrg(orgs.orgA.admin.ctx).select(notes, {
      columns: ["body"],
      orderBy: [asc(notes.position)],
    });

    expect(rows).toEqual([{ body: "a1" }, { body: "a2" }]);
    expectTypeOf(rows).toEqualTypeOf<{ body: string }[]>();
  });

  it("can't reach another org's row through named columns, even when the filter names it", async () => {
    const rows = await forOrg(orgs.orgA.admin.ctx).select(notes, {
      columns: ["id", "body"],
      where: eq(notes.body, "b1"),
    });
    expect(rows).toEqual([]);
  });

  it("names columns with distinctOn too", async () => {
    await forOrg(orgs.orgA.admin.ctx).insert(notes, { body: "a0", position: 1 });

    const rows = await forOrg(orgs.orgA.admin.ctx).select(notes, {
      columns: ["position", "body"],
      distinctOn: [notes.position],
      orderBy: [asc(notes.position), desc(notes.body)],
    });

    expect(rows).toEqual([
      { position: 1, body: "a1" },
      { position: 2, body: "a2" },
    ]);
  });
});

describe("forOrg(ctx).count", () => {
  it("counts only the caller's org's rows", async () => {
    expect(await forOrg(orgs.orgA.member.ctx).count(notes)).toBe(2);
    expect(await forOrg(orgs.orgB.member.ctx).count(notes)).toBe(1);
  });

  it("can't count another org's row even when the filter names it", async () => {
    expect(await forOrg(orgs.orgA.admin.ctx).count(notes, eq(notes.body, "b1"))).toBe(0);
  });
});

describe("forOrg(ctx).sum", () => {
  it("adds up only the caller's org's rows", async () => {
    expect(await forOrg(orgs.orgA.member.ctx).sum(notes, notes.position)).toBe(3);
    expect(await forOrg(orgs.orgB.member.ctx).sum(notes, notes.position)).toBe(1);
  });

  it("is 0 when no row matches, even when the filter names another org's", async () => {
    const sum = await forOrg(orgs.orgA.admin.ctx).sum(notes, notes.position, eq(notes.body, "b1"));
    expect(sum).toBe(0);
  });
});

describe("forOrg(ctx).sumBy", () => {
  it("adds up each group within the caller's org only", async () => {
    await forOrg(orgs.orgA.admin.ctx).insert(notes, [
      { body: "a1", position: 5 },
      { body: "a3", position: 4 },
    ]);
    await forOrg(orgs.orgB.admin.ctx).insert(notes, { body: "a1", position: 100 });

    // Org B has an a1 too: it isn't added to org A's a1.
    const rows = await forOrg(orgs.orgA.admin.ctx).sumBy(notes, notes.position, {
      body: notes.body,
    });

    expectTypeOf(rows).toEqualTypeOf<({ body: string } & { total: number })[]>();
    expect(rows.sort((a, b) => a.body.localeCompare(b.body))).toEqual([
      { body: "a1", total: 6 },
      { body: "a2", total: 2 },
      { body: "a3", total: 4 },
    ]);
    const b = await forOrg(orgs.orgB.admin.ctx).sumBy(notes, notes.position, { body: notes.body });
    expect(b.sort((x, y) => x.body.localeCompare(y.body))).toEqual([
      { body: "a1", total: 100 },
      { body: "b1", total: 1 },
    ]);
  });

  it("groups by several columns, and can't reach another org's row when the filter names it", async () => {
    const db = forOrg(orgs.orgA.admin.ctx);
    await db.insert(notes, { body: "a1", position: 1 });

    const groups = await db.sumBy(notes, notes.position, {
      body: notes.body,
      position: notes.position,
    });
    expect(groups.sort((a, b) => a.position - b.position)).toEqual([
      { body: "a1", position: 1, total: 2 },
      { body: "a2", position: 2, total: 2 },
    ]);
    expect(
      await db.sumBy(notes, notes.position, { body: notes.body }, eq(notes.body, "b1")),
    ).toEqual([]);
    // A group may be SQL computed from the row, typed by what it returns.
    const even = await db.sumBy(notes, notes.position, { even: sql<boolean>`position % 2 = 0` });
    expectTypeOf(even).toEqualTypeOf<({ even: boolean } & { total: number })[]>();
    expect(even.find((group) => group.even)).toEqual({ even: true, total: 2 });
  });
});

describe("forOrg(ctx).countBy", () => {
  it("counts each group within the caller's org only", async () => {
    await forOrg(orgs.orgA.admin.ctx).insert(notes, { body: "a3", position: 2 });

    // Org B has a row at position 1 too: it isn't counted in org A's group.
    const rows = await forOrg(orgs.orgA.admin.ctx).countBy(notes, { position: notes.position });

    expectTypeOf(rows).toEqualTypeOf<({ position: number } & { count: number })[]>();
    expect(rows.sort((a, b) => a.position - b.position)).toEqual([
      { position: 1, count: 1 },
      { position: 2, count: 2 },
    ]);
  });

  it("can't count another org's row even when the filter names it", async () => {
    const rows = await forOrg(orgs.orgA.admin.ctx).countBy(
      notes,
      { body: notes.body },
      eq(notes.body, "b1"),
    );
    expect(rows).toEqual([]);
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

  it("sets each row its own value from SQL, still only in the caller's org", async () => {
    const renamed = sql`case ${notes.body} when 'a1' then 'first' when 'b1' then 'hijacked' else ${notes.body} end`;
    const counted = await countQueries(() =>
      forOrg(orgs.orgA.admin.ctx).update(notes, { body: renamed }),
    );

    expect(counted.queries).toBe(1);
    expect(bodies(await forOrg(orgs.orgA.admin.ctx).select(notes))).toEqual(["a2", "first"]);
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

describe("forOrg(ctx).deleteCount", () => {
  it("deletes only the caller's org's rows, counting them", async () => {
    expect(await forOrg(orgs.orgA.admin.ctx).deleteCount(notes)).toBe(2);

    expect(await forOrg(orgs.orgA.admin.ctx).select(notes)).toEqual([]);
    expect(bodies(await forOrg(orgs.orgB.admin.ctx).select(notes))).toEqual(["b1"]);
  });

  it("can't delete another org's row even when the filter names it", async () => {
    expect(await forOrg(orgs.orgA.admin.ctx).deleteCount(notes, eq(notes.body, "b1"))).toBe(0);

    expect(bodies(await forOrg(orgs.orgB.admin.ctx).select(notes))).toEqual(["b1"]);
  });

  it("returns no rows from the database", async () => {
    const counted = await countQueries(() =>
      forOrg(orgs.orgA.admin.ctx).deleteCount(notes, eq(notes.body, "a1")),
    );

    expect(counted).toEqual({ queries: 1, rows: 0 });
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

  it("counts and sums inside the caller's org, seeing the transaction's own writes", async () => {
    const counted = await forOrg(orgs.orgA.admin.ctx).transaction(async (tx) => {
      await tx.insert(notes, { body: "a3", position: 1 });
      return {
        count: await tx.count(notes),
        sum: await tx.sum(notes, notes.position),
        groups: await tx.countBy(notes, { position: notes.position }),
        totals: await tx.sumBy(notes, notes.position, { position: notes.position }),
      };
    });

    expect(counted.count).toBe(3);
    expect(counted.sum).toBe(4);
    expect(counted.totals.sort((a, b) => a.position - b.position)).toEqual([
      { position: 1, total: 2 },
      { position: 2, total: 2 },
    ]);
    expect(counted.groups.sort((a, b) => a.position - b.position)).toEqual([
      { position: 1, count: 2 },
      { position: 2, count: 1 },
    ]);
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
