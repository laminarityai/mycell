// Every foreign key needs an index led by its referencing columns. Without one, deleting a
// referenced row (a connection, a run, a member) scans the whole referencing table to cascade
// or check it, and a read joining on the key does the same. Checked against the migrated
// database's catalog, so a table added later is covered without being listed here.
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../client";

describe("foreign keys", () => {
  it("each have an index whose leading columns are the key's referencing columns", async () => {
    // A foreign key's lookups compare every one of its columns for equality, so an index serves
    // them when its first columns are exactly the key's, in any order. A tenant key's `org_id`
    // may be left out: the other column is an ID no other org's row has, so the index on it
    // alone (`connection_id`, say) finds the same rows. A partial or expression index doesn't
    // count: it can't serve every lookup.
    const unindexed = await getDb().execute<{ key: string }>(sql`
      with foreign_keys as (
        select
          c.conname,
          c.conrelid,
          c.conkey,
          array(
            select k.attnum
            from unnest(c.conkey) as k(attnum)
            join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
            where a.attname <> 'org_id'
          ) as id_columns
        from pg_constraint c
        where c.contype = 'f' and c.connamespace = 'public'::regnamespace
      ),
      leading_columns as (
        select i.indrelid, i.indnkeyatts, array_agg(u.attnum order by u.position) as columns
        from pg_index i
        cross join lateral unnest(i.indkey::int2[]) with ordinality as u(attnum, position)
        where i.indpred is null and i.indexprs is null
        group by i.indexrelid, i.indrelid, i.indnkeyatts
      )
      select f.conrelid::regclass::text || ' (' || (
        select string_agg(a.attname, ', ' order by k.n)
        from unnest(f.conkey) with ordinality as k(attnum, n)
        join pg_attribute a on a.attrelid = f.conrelid and a.attnum = k.attnum
      ) || '): ' || f.conname as key
      from foreign_keys f
      where not exists (
        select 1
        from leading_columns i
        where i.indrelid = f.conrelid
          and exists (
            select 1
            from (values (f.conkey), (f.id_columns)) as wanted(columns)
            where cardinality(wanted.columns) between 1 and i.indnkeyatts
              and i.columns[1:cardinality(wanted.columns)] @> wanted.columns
          )
      )
      order by key
    `);

    expect(unindexed.rows.map((row) => row.key)).toEqual([]);
  });
});
