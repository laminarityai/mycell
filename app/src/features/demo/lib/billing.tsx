"use client";

import { CreditCard } from "lucide-react";
import { useState } from "react";
import { DateTime } from "@/components/date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DEMO_TODAY, demoDate, demoRequests } from "../data";
import { count, money } from "../format";

type Bill = { month: string; closes: Date; amount: number; requests: number; open: boolean };

// One bill per calendar month (UTC), closing on the month's last day.
function monthlyBills(): Bill[] {
  const bills = new Map<string, Bill>();
  for (const request of demoRequests) {
    const date = demoDate(request.day);
    const month = date.toISOString().slice(0, 7);
    const bill = bills.get(month) ?? {
      month,
      closes: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)),
      amount: 0,
      requests: 0,
      open: month === DEMO_TODAY.toISOString().slice(0, 7),
    };
    bill.amount += request.cost;
    bill.requests++;
    bills.set(month, bill);
  }
  return [...bills.values()].sort((a, b) => b.month.localeCompare(a.month));
}

const bills = monthlyBills();
const sampleCards = [
  { id: 1, label: "Visa •••• 4242", expires: "08/28" },
  { id: 2, label: "Mastercard •••• 4444", expires: "02/27" },
];

/** Usage is billed once a month, on the month's last day, to the default card. */
export function DemoBilling() {
  const [defaultCard, setDefaultCard] = useState(1);
  const [adding, setAdding] = useState(false);
  const current = bills.find((bill) => bill.open);
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Month to date</CardDescription>
            <CardTitle className="text-2xl">{money(current?.amount ?? 0)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Next bill date</CardDescription>
            <CardTitle className="text-2xl">
              {current ? <DateTime value={current.closes} day /> : "—"}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Payment method</CardDescription>
            <CardTitle className="text-2xl">
              {sampleCards.find((card) => card.id === defaultCard)?.label}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Payment methods</CardTitle>
          <CardDescription>
            The default card is charged when each monthly bill closes. These are sample cards.
          </CardDescription>
          <CardAction>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setAdding(true);
              }}
            >
              Add payment method
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-2">
          {sampleCards.map((card) => (
            <div key={card.id} className="flex items-center gap-3 rounded-lg border px-4 py-3">
              <CreditCard className="size-5 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-sm font-medium">{card.label}</p>
                <p className="text-xs text-muted-foreground">Expires {card.expires}</p>
              </div>
              {card.id === defaultCard ? (
                <Badge variant="secondary">Default</Badge>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDefaultCard(card.id);
                  }}
                >
                  Make default
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Monthly bills</CardTitle>
          <CardDescription>You pay for what your organization used, once a month.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                {["Month", "Requests", "Billed on", "Status", "Amount"].map((heading) => (
                  <TableHead key={heading}>{heading}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {bills.map((bill) => (
                <TableRow key={bill.month}>
                  <TableCell className="font-medium">{bill.month}</TableCell>
                  <TableCell>{count(bill.requests)}</TableCell>
                  <TableCell>
                    <DateTime value={bill.closes} day />
                  </TableCell>
                  <TableCell>
                    <Badge variant={bill.open ? "outline" : "secondary"}>
                      {bill.open ? "In progress" : "Paid"}
                    </Badge>
                  </TableCell>
                  <TableCell>{money(bill.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add payment method</DialogTitle>
            <DialogDescription>
              In the product this opens the payment provider&apos;s secure card form. The demo
              doesn&apos;t collect card details.
            </DialogDescription>
          </DialogHeader>
          <Button
            onClick={() => {
              setAdding(false);
            }}
          >
            Close
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
