"use client";

import { useState } from "react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { compact, count, money } from "../format";
import type { UsageRow } from "../types";
import { totalOf } from "../usage";

const orders = {
  Savings: (row: UsageRow) => -(row.baseline - totalOf(row.spend)),
  Requests: (row: UsageRow) => -totalOf(row.requests),
  Tokens: (row: UsageRow) => -totalOf(row.tokens),
  Latency: (row: UsageRow) => row.latencyMs,
  Cost: (row: UsageRow) => totalOf(row.spend),
};
type Order = keyof typeof orders;

/** A ranking table that can be reordered; `nameLabel` and `groupLabel` name its first columns. */
export function UsageRankings({
  title,
  nameLabel,
  groupLabel,
  rows,
  idOf,
}: {
  title: string;
  nameLabel: string;
  groupLabel: string;
  rows: UsageRow[];
  idOf?: (name: string) => string;
}) {
  const [order, setOrder] = useState<Order>("Savings");
  const sorted = [...rows].sort((a, b) => orders[order](a) - orders[order](b));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Ranked by {order.toLowerCase()} over the last 90 days.</CardDescription>
        <CardAction>
          <NativeSelect
            aria-label={`Rank ${nameLabel.toLowerCase()}s by`}
            value={order}
            onChange={(event) => {
              setOrder(event.target.value as Order);
            }}
          >
            {Object.keys(orders).map((option) => (
              <NativeSelectOption key={option}>{option}</NativeSelectOption>
            ))}
          </NativeSelect>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              {[
                "Rank",
                nameLabel,
                ...(idOf ? [`${nameLabel} ID`] : []),
                groupLabel,
                "Requests",
                "Tokens",
                "Latency",
                "Spend",
                "Savings",
                "Efficiency",
              ].map((heading) => (
                <TableHead key={heading}>{heading}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row, index) => {
              const spend = totalOf(row.spend);
              return (
                <TableRow key={row.name}>
                  <TableCell>{index + 1}</TableCell>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  {idOf && (
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {idOf(row.name)}
                    </TableCell>
                  )}
                  <TableCell>{row.subtitle}</TableCell>
                  <TableCell>{count(totalOf(row.requests))}</TableCell>
                  <TableCell>{compact(totalOf(row.tokens))}</TableCell>
                  <TableCell>{count(row.latencyMs)} ms</TableCell>
                  <TableCell>{money(spend)}</TableCell>
                  <TableCell>{money(row.baseline - spend)}</TableCell>
                  <TableCell>
                    {row.baseline ? (((row.baseline - spend) / row.baseline) * 100).toFixed(1) : 0}%
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
