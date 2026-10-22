"use client";

// PROTOTYPE, throwaway: what every Alerts variant needs besides its layout: an alert's fix
// (a link, or a stub that says it started), the out-of-credits banner the app shell shows on
// every page, and what a member sees instead of alerts.
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Alert } from "./alert-data";
import { memberNotices } from "./alert-data";

export function FixButton({
  alert,
  size = "sm",
  variant = "outline",
  className,
}: {
  alert: Alert;
  size?: "sm" | "default" | "lg" | "xs";
  variant?: "outline" | "default" | "link";
  className?: string;
}) {
  const [done, setDone] = useState(false);
  const { fix } = alert;
  if ("href" in fix) {
    return (
      <Button asChild size={size} variant={variant} className={className}>
        <Link href={fix.href}>{fix.label}</Link>
      </Button>
    );
  }
  if (done) return <span className="text-sm text-muted-foreground">{fix.stub}</span>;
  return (
    <Button
      size={size}
      variant={variant}
      className={className}
      onClick={() => {
        setDone(true);
      }}
    >
      {fix.label}
    </Button>
  );
}

/** The app shell's banner for admins while credits are out; it shows on every page. */
export function OutOfCreditsBanner() {
  return (
    <div className="bg-red-700 px-4 py-2 text-center text-sm text-white">
      Mycel is out of credits, so every workflow is paused.{" "}
      <Link href="/prototype/credits" className="font-medium underline">
        See credits
      </Link>
    </div>
  );
}

/** A member gets no alerts: their reviews, their pauses and their connection, as today. */
export function MemberNotices({ state }: { state: string }) {
  const { pauses, waitingReviews } = memberNotices(state);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Members don&apos;t get alerts, and there&apos;s no Alerts link in their navigation. This is
        what Priya sees of the same state, where she already looks:
      </p>
      <ul className="flex flex-col divide-y rounded-lg border text-sm">
        <li className="flex items-center justify-between gap-4 p-3">
          <span>{waitingReviews} reviews wait for you</span>
          <Link href="/prototype/review-cards" className="underline">
            Reviews
          </Link>
        </li>
        {pauses.map((p) => (
          <li key={p.name} className="flex items-center justify-between gap-4 p-3">
            <span>{p.name}</span>
            <span className="text-muted-foreground">Paused: {p.reason}</span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-4 p-3">
          <span>priya@fernhill.co</span>
          <span className="text-muted-foreground">Connected</span>
        </li>
      </ul>
    </div>
  );
}
