// forOrg(ctx).select's computed values: SQL evaluated per row beside the columns, on the org's
// rows only.
import { asc, eq, sql } from "drizzle-orm";
import { integer, pgTable, serial, text } from "drizzle-orm/pg-core";
import { beforeAll, beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import { getDb } from "../client";
import { forOrg } from "../for-org";
import { resetDatabase } from "../testing/reset";
import { seedTwoOrgs, type TwoOrgs } from "../testing/two-org-fixture";

// A tenant-owned table that exists only in tests: it has no migration.
const notes = pgTable("test_computed_notes", {
  id: serial("id").primaryKey(),
  orgId: text("org_id").notNull(),
  body: text("body").notNull(),
  position: integer("position").notNull().default(0),
});

let orgs: TwoOrgs;

beforeAll(async () => {
  await getDb().execute(sql`
    create table if not exists test_computed_notes (
      id serial primary key,
      org_id text not null references organization(id) on delete cascade,
      body text not null,
      position integer not null default 0
    )
  `);
  // Every foreign key is indexed (foreign-key-indexes.test.ts), this table's too.
  await getDb().execute(
    sql`create index if not exists test_computed_notes_org_id_idx on test_computed_notes (org_id)`,
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

describe("forOrg(ctx).select's computed values", () => {
  it("are computed per row beside the named columns, within the org", async () => {
    const rows = await forOrg(orgs.orgA.admin.ctx).select(notes, {
      columns: ["body"],
      computed: { shout: sql<string>`upper(${notes.body})` },
      orderBy: [asc(notes.position)],
    });

    expect(rows).toEqual([
      { body: "a1", shout: "A1" },
      { body: "a2", shout: "A2" },
    ]);
    expectTypeOf(rows).toEqualTypeOf<{ body: string; shout: string }[]>();
  });

  it("come beside every column when none are named, and can't reach another org's row", async () => {
    const twice = { twice: sql<number>`${notes.position} * 2` };
    const own = await forOrg(orgs.orgA.admin.ctx).select(notes, {
      computed: twice,
      where: eq(notes.body, "a2"),
    });
    const other = await forOrg(orgs.orgA.admin.ctx).select(notes, {
      computed: twice,
      where: eq(notes.body, "b1"),
    });

    expect(own).toEqual([expect.objectContaining({ body: "a2", position: 2, twice: 4 })]);
    expectTypeOf(own[0]).toHaveProperty("twice").toEqualTypeOf<number>();
    expect(other).toEqual([]);
  });

  it("leave a row as its columns when nothing is computed", async () => {
    const rows = await forOrg(orgs.orgA.admin.ctx).select(notes, { columns: ["body"] });

    expectTypeOf(rows).toEqualTypeOf<{ body: string }[]>();
    expect(rows.map((row) => Object.keys(row))).toEqual([["body"], ["body"]]);
  });
});
