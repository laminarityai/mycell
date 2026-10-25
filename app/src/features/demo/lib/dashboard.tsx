import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEMO_DAYS, demoDate, demoRequests } from "../data";
import { count, money } from "../format";
import { spendByGroup, summaryOf } from "../usage";
import { StackedBars } from "./stacked-bars";

const days = Array.from({ length: DEMO_DAYS }, (_, index) =>
  demoDate(DEMO_DAYS - 1 - index)
    .toISOString()
    .slice(0, 10),
);

export function DemoDashboard() {
  const summary = summaryOf(demoRequests);
  const { series, projected } = spendByGroup(demoRequests);
  const metrics = [
    ["Active agents", count(summary.agents)],
    ["Requests processed", count(summary.requests)],
    ["Spend", money(summary.spend)],
    ["Savings vs baseline", money(summary.savings)],
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map(([title, value]) => (
          <Card key={title}>
            <CardHeader>
              <CardDescription>{title}</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Spend comparison</CardTitle>
          <CardDescription>
            Stacked spend by team · Actual vs. projected spend without routing, in USD, last 90 days
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StackedBars
            label="Daily spend by team, with projected spend without routing"
            days={days}
            series={series}
            line={projected}
            lineLabel="Projected spend without routing"
            format={money}
          />
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {series.map((row) => (
              <li key={row.name}>{row.name}</li>
            ))}
            <li>Line: projected spend without routing</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
