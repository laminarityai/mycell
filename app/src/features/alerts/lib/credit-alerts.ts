// The credit alerts, from the balance and its runway: out when the balance is at or below zero
// (the same test that pauses every workflow), else low when it lasts under 7 days at the last 7
// days' rate. Neither knows when it began: the ledger records spending, not crossings.
import { formatCredits } from "@/features/credits/format";
import type { Runway } from "@/features/credits/types";
import type { Alert } from "../types";

/** Fewer days than this at this week's rate, and credits are low. */
const LOW_DAYS = 7;

const SEE_CREDITS = { label: "See credits", href: "/credits" };

export function creditAlerts(runway: Runway): Alert[] {
  if (runway.balance <= 0) {
    return [
      {
        id: "credits_out",
        kind: "credits_out",
        subject: { type: "credits" },
        startedAt: null,
        sentence:
          "Credits ran out. Every workflow is paused, and the builder chat and Try it can't answer until more are granted.",
        clearsWhen: "Once credits are granted.",
        fix: SEE_CREDITS,
      },
    ];
  }
  if (runway.days === null || runway.dailyRate === null || runway.days >= LOW_DAYS) return [];
  return [
    {
      id: "credits_low",
      kind: "credits_low",
      subject: { type: "credits" },
      startedAt: null,
      sentence: `At this week's rate (${formatCredits(runway.dailyRate)} a day), the ${formatCredits(runway.balance)} credits left last ${daysText(runway.days)}.`,
      clearsWhen: `Once more than ${String(LOW_DAYS)} days are left.`,
      fix: SEE_CREDITS,
    },
  ];
}

function daysText(days: number): string {
  const whole = Math.floor(days);
  if (whole === 0) return "less than a day";
  return `about ${String(whole)} ${whole === 1 ? "day" : "days"}`;
}
