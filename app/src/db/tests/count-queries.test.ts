import { sql } from "drizzle-orm";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { getDb } from "../client";
import { countQueries } from "../testing/count-queries";

const threeRows = sql`select * from generate_series(1, 3)`;

describe("countQueries", () => {
  it("counts each query the pool runs and the rows it returns", async () => {
    const counted = await countQueries(async () => {
      await getDb().execute(threeRows);
      await getDb().execute(sql`select 1`);
    });

    expect(counted).toEqual({ queries: 2, rows: 4 });
  });

  it("counts a transaction's queries, its begin and commit included", async () => {
    const counted = await countQueries(() =>
      getDb().transaction(async (tx) => {
        await tx.execute(threeRows);
      }),
    );

    expect(counted).toEqual({ queries: 3, rows: 3 });
  });

  it("stops counting when the callback settles, even when it throws", async () => {
    const before: unknown = Reflect.get(Client.prototype, "query");

    const failing = countQueries(async () => {
      await getDb().execute(sql`select 1`);
      throw new Error("halfway");
    });

    await expect(failing).rejects.toThrow("halfway");
    expect(Reflect.get(Client.prototype, "query")).toBe(before);
  });
});
