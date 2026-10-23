import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../client";
import { queriesOnOtherConnections } from "../testing/transaction-queries";

describe("queriesOnOtherConnections", () => {
  it("lists a query the pool runs while a transaction is open", async () => {
    const stray = await queriesOnOtherConnections(() =>
      getDb().transaction(async (tx) => {
        await tx.execute(sql`select 1`);
        await getDb().execute(sql`select 2`);
      }),
    );

    expect(stray).toEqual(["select 2"]);
  });

  it("lists nothing for a transaction that queries only through its own connection", async () => {
    const stray = await queriesOnOtherConnections(async () => {
      await getDb().execute(sql`select 1`);
      await getDb().transaction(async (tx) => {
        await tx.execute(sql`select 2`);
      });
      await getDb().execute(sql`select 3`);
    });

    expect(stray).toEqual([]);
  });

  it("stops at a rolled-back transaction's end", async () => {
    const stray = await queriesOnOtherConnections(async () => {
      const failing = getDb().transaction(async (tx) => {
        await tx.execute(sql`select 1`);
        throw new Error("halfway");
      });
      await expect(failing).rejects.toThrow("halfway");
      await getDb().execute(sql`select 2`);
    });

    expect(stray).toEqual([]);
  });
});
