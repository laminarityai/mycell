"use client";

// PROTOTYPE, throwaway: Alerts live in a bell in the navigation, on every page. Its popover
// (open here so it shows) lists them with one fix each; "See all" is the page under it, a plain
// table of the same alerts.
import { Bell } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DateTime } from "@/components/date-time";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NAV_CLASS, NavLinks } from "@/app/nav-links";
import { cn } from "@/lib/utils";
import { FIXTURE_COUNTS } from "../_shared/fixtures";
import { PrototypeMain } from "../_shared/header";
import type { VariantProps } from "../_shared/prototype-page";
import { ago, alertsFor, type Alert } from "./alert-data";
import { FixButton, MemberNotices, OutOfCreditsBanner } from "./alert-parts";

export function VariantC({ params }: VariantProps) {
  const admin = params.as === "admin";
  const alerts = alertsFor(params.state);
  return (
    <>
      {admin && params.state === "out" ? <OutOfCreditsBanner /> : null}
      <PrototypeMain wide>
        <header className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">
            {admin ? "All alerts" : "Your notices"}
          </h1>
          <nav aria-label="Main" className={NAV_CLASS}>
            <Link href="/prototype/ask" className="hover:text-foreground">
              Ask Mycel
            </Link>
            <NavLinks waiting={FIXTURE_COUNTS.waitingReviews} admin={admin} />
            <Link href="/prototype/runs" className="hover:text-foreground">
              Runs
            </Link>
            {admin ? (
              <>
                <Link href="/prototype/credits" className="hover:text-foreground">
                  Credits
                </Link>
                <AlertBell alerts={alerts} />
              </>
            ) : null}
          </nav>
        </header>
        {admin ? <AllAlerts alerts={alerts} /> : <MemberNotices state={params.state} />}
      </PrototypeMain>
    </>
  );
}

function AlertBell({ alerts }: { alerts: Alert[] }) {
  const [open, setOpen] = useState(true);
  return (
    <span className="relative">
      <button
        type="button"
        aria-label={`Alerts, ${String(alerts.length)} open`}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
        className={cn(
          "relative inline-flex size-8 items-center justify-center rounded-full hover:bg-muted",
          open && "bg-muted text-foreground",
        )}
      >
        <Bell className="size-4" />
        {alerts.length === 0 ? null : (
          <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-semibold text-white">
            {alerts.length}
          </span>
        )}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Alerts"
          className="absolute top-10 left-0 z-50 flex w-[22rem] flex-col rounded-lg border bg-popover text-popover-foreground shadow-xl"
        >
          <p className="border-b px-4 py-2.5 text-sm font-medium">
            {alerts.length === 0 ? "No alerts" : `${String(alerts.length)} alerts`}
          </p>
          {alerts.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Nothing needs you right now.</p>
          ) : (
            <ul className="flex max-h-96 flex-col divide-y overflow-y-auto">
              {alerts.map((a) => (
                <li key={a.id} className="flex flex-col gap-1.5 px-4 py-3">
                  <span className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium text-foreground">
                      {a.group === "Credits" ? a.title : a.subject}
                    </span>
                    {a.since === undefined ? null : (
                      <span className="shrink-0 text-xs text-muted-foreground">{ago(a.since)}</span>
                    )}
                  </span>
                  {a.group === "Credits" ? null : (
                    <span className="text-xs text-muted-foreground">{a.title}</span>
                  )}
                  <FixButton alert={a} size="xs" className="w-fit" />
                </li>
              ))}
            </ul>
          )}
          <a href="#all" className="border-t px-4 py-2.5 text-center text-sm underline">
            See all alerts
          </a>
        </div>
      ) : null}
    </span>
  );
}

function AllAlerts({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) {
    return (
      <p id="all" className="text-sm text-muted-foreground">
        No alerts. They appear here and in the bell when something needs you, and go away once
        it&apos;s fixed.
      </p>
    );
  }
  return (
    <section id="all" className="mt-80 flex flex-col gap-2 md:mt-64">
      <p className="text-sm text-muted-foreground">
        Every open alert. Each one goes away by itself once its cause is fixed.
      </p>
      <Table aria-label="All alerts">
        <TableHeader>
          <TableRow>
            <TableHead>Started</TableHead>
            <TableHead>About</TableHead>
            <TableHead>What happened</TableHead>
            <TableHead>Fix</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {alerts.map((a) => (
            <TableRow key={a.id} className="align-top">
              <TableCell className="text-xs">
                {a.since === undefined ? "Ongoing" : <DateTime value={a.since} />}
              </TableCell>
              <TableCell className="font-medium">{a.subject}</TableCell>
              <TableCell className="max-w-md text-sm whitespace-normal">
                <span className="block font-medium">{a.title}</span>
                <span className="text-muted-foreground">{a.what}</span>
              </TableCell>
              <TableCell>
                <FixButton alert={a} variant="link" className="px-0" />
                <span className="block text-xs text-muted-foreground">{a.clears}</span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
