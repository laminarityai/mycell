"use client";

// Ranked rows beside their daily stacked bars, with a Volume / Spend toggle. The models and
// agents screens both use it, so the two look the same.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DEMO_DAYS, demoDate } from "../data";
import { compact, money, percent } from "../format";
import type { UsageRow } from "../types";
import { halfChange, totalOf } from "../usage";
import { chartColors, StackedBars } from "./stacked-bars";

const days = Array.from({ length: DEMO_DAYS }, (_, index) =>
  demoDate(DEMO_DAYS - 1 - index)
    .toISOString()
    .slice(0, 10),
);

export function UsageLeaderboard({
  title,
  subject,
  rows,
}: {
  title: string;
  subject: string;
  rows: UsageRow[];
}) {
  const [metric, setMetric] = useState<"tokens" | "spend">("spend");
  const [selected, setSelected] = useState<string | null>(null);
  const ranked = [...rows].sort((a, b) => totalOf(b[metric]) - totalOf(a[metric]));
  const top = ranked.slice(0, 8);
  const rest = ranked.slice(8);
  const shown = rest.length
    ? [
        ...top,
        {
          ...rest[0],
          name: "Other",
          subtitle: `${String(rest.length)} remaining ${subject}s`,
          tokens: days.map((_, i) => totalOf(rest.map((row) => row.tokens[i]))),
          spend: days.map((_, i) => totalOf(rest.map((row) => row.spend[i]))),
        },
      ]
    : top;
  const format = (value: number) =>
    metric === "spend" ? money(value) : `${compact(value)} tokens`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          Top 8 {subject}s by {metric === "spend" ? "actual spend" : "token volume"}; Other includes
          the remaining {subject}s.
        </CardDescription>
        <CardAction>
          <div className="flex rounded-md border p-1" role="group" aria-label={`${title} metric`}>
            <Button
              size="sm"
              variant={metric === "tokens" ? "secondary" : "ghost"}
              aria-pressed={metric === "tokens"}
              onClick={() => {
                setMetric("tokens");
              }}
            >
              Volume
            </Button>
            <Button
              size="sm"
              variant={metric === "spend" ? "secondary" : "ghost"}
              aria-pressed={metric === "spend"}
              onClick={() => {
                setMetric("spend");
              }}
            >
              Spend
            </Button>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-6 xl:grid-cols-[minmax(270px,0.75fr)_minmax(0,1.6fr)]">
        <ol className="divide-y rounded-lg border">
          {shown.map((row, index) => {
            const change = halfChange(row[metric]);
            return (
              <li key={row.name}>
                <Button
                  variant="ghost"
                  className="grid h-auto w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 rounded-none px-3 py-3 text-left"
                  aria-pressed={selected === row.name}
                  onClick={() => {
                    setSelected(selected === row.name ? null : row.name);
                  }}
                >
                  <span className="text-lg font-semibold text-muted-foreground">
                    {row.name === "Other" ? "·" : index + 1}
                  </span>
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: chartColors[index % chartColors.length] }}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{row.name}</span>
                      <span className="block text-xs text-muted-foreground">{row.subtitle}</span>
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-sm font-medium">
                      {format(totalOf(row[metric]))}
                    </span>
                    <span
                      className={
                        change === null || change >= 0
                          ? "text-xs text-emerald-600 dark:text-emerald-400"
                          : "text-xs text-rose-500"
                      }
                    >
                      {change === null ? "—" : percent(change)}
                    </span>
                  </span>
                </Button>
              </li>
            );
          })}
        </ol>
        <StackedBars
          label={`${title}, daily ${metric === "spend" ? "spend" : "tokens"}`}
          days={days}
          series={shown.map((row) => ({ name: row.name, values: row[metric] }))}
          format={metric === "spend" ? money : compact}
          highlighted={selected}
        />
      </CardContent>
    </Card>
  );
}
