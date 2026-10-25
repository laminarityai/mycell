import { describe, expect, it } from "vitest";
import { DEMO_DAYS, demoMembers, demoRequests } from "@/features/demo/data";
import type { DemoRequest } from "@/features/demo/types";
import { halfChange, summaryOf, usageBy } from "@/features/demo/usage";

const request = (day: number, agent: string, tokens: number, cost: number): DemoRequest => ({
  id: day,
  member: 1,
  agent,
  model: "gpt-6-sol",
  provider: "OpenAI",
  task: agent,
  summary: "",
  day,
  tokens,
  latencyMs: 1000,
  cost,
  baseline: cost * 2,
});

describe("demo data", () => {
  it("is the same on every load, covers 90 days, and only counts people after they joined", () => {
    expect(demoRequests.length).toBeGreaterThan(10_000);
    expect(new Set(demoRequests.map((item) => item.day)).size).toBe(DEMO_DAYS);
    const joined = new Map(demoMembers.map((member) => [member.id, member.joinedDaysAgo]));
    expect(demoRequests.every((item) => item.day <= (joined.get(item.member) ?? -1))).toBe(true);
    expect(demoRequests.every((item) => item.cost > 0 && item.cost < item.baseline)).toBe(true);
  });
});

describe("usageBy", () => {
  it("totals each name per day, oldest day first", () => {
    const rows = usageBy(
      [
        request(0, "Support Triage", 100, 2),
        request(0, "Support Triage", 50, 1),
        request(2, "Support Triage", 10, 1),
      ],
      (item) => item.agent,
      () => "Support",
      3,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].requests).toEqual([1, 0, 2]);
    expect(rows[0].tokens).toEqual([10, 0, 150]);
    expect(rows[0].baseline).toBe(8);
  });

  it("leaves out requests older than the window", () => {
    expect(
      usageBy(
        [request(5, "Data Analyst", 1, 1)],
        (item) => item.agent,
        () => "",
        3,
      ),
    ).toEqual([]);
  });
});

describe("halfChange and summaryOf", () => {
  it("compare the two halves of a series and total a window", () => {
    expect(halfChange([1, 1, 2, 2])).toBe(100);
    expect(halfChange([0, 0, 0, 3])).toBeNull();
    const summary = summaryOf([request(0, "A", 10, 1), request(1, "B", 20, 2)], 1);
    expect(summary).toMatchObject({ requests: 1, tokens: 10, spend: 1, savings: 1, agents: 1 });
  });
});
