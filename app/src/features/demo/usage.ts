// Totals the demo requests into the rows the dashboard, agents, and models screens draw.
import { DEMO_DAYS, demoMembers, topGroupOf } from "./data";
import type { DemoRequest, UsageRow } from "./types";

const zeros = (length: number) => Array.from({ length }, () => 0);
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** Daily totals per name (agent or model), oldest day first, for the last `days` days. */
export function usageBy(
  requests: DemoRequest[],
  nameOf: (request: DemoRequest) => string,
  subtitleOf: (request: DemoRequest) => string,
  days = DEMO_DAYS,
): UsageRow[] {
  const rows = new Map<string, UsageRow & { latencyTotal: number }>();
  for (const request of requests) {
    if (request.day >= days) continue;
    const name = nameOf(request);
    let row = rows.get(name);
    if (!row) {
      row = {
        name,
        subtitle: subtitleOf(request),
        requests: zeros(days),
        tokens: zeros(days),
        spend: zeros(days),
        latencyMs: 0,
        latencyTotal: 0,
        baseline: 0,
      };
      rows.set(name, row);
    }
    const index = days - 1 - request.day;
    row.requests[index]++;
    row.tokens[index] += request.tokens;
    row.spend[index] += request.cost;
    row.latencyTotal += request.latencyMs;
    row.baseline += request.baseline;
  }
  return [...rows.values()].map(({ latencyTotal, ...row }) => ({
    ...row,
    latencyMs: Math.round(latencyTotal / Math.max(1, sum(row.requests))),
  }));
}

export const totalOf = (values: number[]) => sum(values);

/** Change between the first and second half of a series, as a percentage; null when undefined. */
export function halfChange(values: number[]) {
  const middle = Math.ceil(values.length / 2);
  const before = sum(values.slice(0, middle));
  const after = sum(values.slice(middle));
  if (!before) return after ? null : 0;
  return ((after - before) / before) * 100;
}

/** Daily spend per top-level group, and what the same days would have cost without routing. */
export function spendByGroup(requests: DemoRequest[], days = DEMO_DAYS) {
  const groupOf = new Map(demoMembers.map((member) => [member.id, topGroupOf(member.group)]));
  const series = new Map<string, number[]>();
  const projected = zeros(days);
  for (const request of requests) {
    if (request.day >= days) continue;
    const group = groupOf.get(request.member) ?? "Other";
    const values = series.get(group) ?? zeros(days);
    values[days - 1 - request.day] += request.cost;
    series.set(group, values);
    projected[days - 1 - request.day] += request.baseline;
  }
  return { series: [...series].map(([name, values]) => ({ name, values })), projected };
}

export function summaryOf(requests: DemoRequest[], days = DEMO_DAYS) {
  const shown = requests.filter((request) => request.day < days);
  const spend = sum(shown.map((request) => request.cost));
  const baseline = sum(shown.map((request) => request.baseline));
  return {
    requests: shown.length,
    tokens: sum(shown.map((request) => request.tokens)),
    spend,
    savings: baseline - spend,
    agents: new Set(shown.map((request) => request.agent)).size,
  };
}
